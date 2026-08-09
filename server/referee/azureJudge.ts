import type OpenAI from 'openai';
import { CategoryKey, UserAnswers } from '../../src/types';
import { ContentFilterError, createStructuredCompleter } from '../azure/structuredCompletion';
import { CATEGORY_KEYS, SCORING } from './scoring';
import { CategoryJudgement, Judge, JudgeRequest, JudgeVerdict } from './types';
import { UNSCOREABLE, onlyCategory, withoutCategories } from './contentFilter';

/**
 * One category's shape, defined once here and inlined four times when the schema
 * is built. Inlining rather than using $ref/$defs keeps the wire format to the
 * plainest subset of JSON Schema, avoiding any question of how strict mode
 * handles references.
 */
function categoryJudgementSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      valid: { type: 'boolean' },
      // Deliberately ordered before bonusMatched. Structured output is generated
      // in schema order, so stating the evidence first stops the model asserting
      // a match it then contradicts in its own feedback.
      bonusEvidence: { type: 'string' },
      bonusMatched: { type: 'boolean' },
      feedback: { type: 'string' },
      suggestion: { type: 'string' },
    },
    // Strict mode requires every property to be listed.
    required: ['valid', 'bonusEvidence', 'bonusMatched', 'feedback', 'suggestion'],
  };
}

/**
 * Note the absence of `points`: the referee derives them, so the model cannot
 * invent a score.
 */
export function buildVerdictSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      categories: {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(
          CATEGORY_KEYS.map((key) => [key, categoryJudgementSchema()])
        ),
        required: [...CATEGORY_KEYS],
      },
      overallFeedback: { type: 'string' },
      bonusChallengeMet: { type: 'boolean' },
    },
    required: ['categories', 'overallFeedback', 'bonusChallengeMet'],
  };
}

/**
 * The persona and rules, fixed for every round. Kept as a stable prefix so the
 * provider can cache it across requests.
 */
export const JUDGE_SYSTEM_PROMPT = `You are the ultimate fun, fair, and precise AI referee for the classic word puzzle game "Name, Place, Animal, Thing".

RULE 1 OVERRIDES ALL OTHERS. Check it first, for every answer, before you consider anything else.
An answer that fails rule 1 scores nothing, no matter how good it otherwise is.

For each of the four categories you receive, decide:
1. Target Letter: does the answer's first letter equal the target letter, ignoring case? Compare the very first character only. If it does not match, or the answer is empty, then valid = false AND bonusMatched = false — even if the word is a perfect fit for the category and the bonus rule. A famous, on-theme answer starting with the wrong letter is still worth nothing.
2. Category Validity: only if rule 1 passed — is the word a real, recognized item fitting the category?
   - "Name": genuine human first name or famous character.
   - "Place": real city, country, state, river, mountain, or landmark.
   - "Animal": real animal species, bird, fish, reptile, insect, etc.
   - "Thing": real physical object, item, tool, food, vehicle, element, etc.
3. bonusEvidence: state in a few words whether this specific answer satisfies the active bonus rule, and why. Write this BEFORE deciding bonusMatched.
4. bonusMatched: set it to exactly what your bonusEvidence just said. If the evidence says the answer does not satisfy the rule, bonusMatched MUST be false. Never contradict your own evidence. When in doubt, use false. If rule 1 or rule 2 failed, bonusMatched must be false.
5. feedback: witty and concise, maximum 10 words. It must agree with valid and bonusMatched. When an answer fails rule 1, say so plainly.
6. suggestion: when valid is false, give ONE example answer that would have worked — a real item in that category starting with the target letter, satisfying the bonus rule if possible. Just the word, nothing else. When valid is true, use an empty string.

Set bonusChallengeMet to true when at least ${SCORING.bonusChallengeThreshold} categories satisfy the bonus rule.

Do not assign points. Scoring is applied separately.`;

/** The per-round data. Everything variable lives here, after the cacheable prefix. */
export function buildUserPrompt({ letter, answers, bonusChallenge }: JudgeRequest): string {
  const target = letter.toUpperCase();

  return `Target letter: "${target}".
Active Bonus Challenge: "${bonusChallenge?.title || 'Bonus'}: ${bonusChallenge?.description || 'Extra points for valid entries'}".

Answers to evaluate:
- Name: "${answers.name || ''}"
- Place: "${answers.place || ''}"
- Animal: "${answers.animal || ''}"
- Thing: "${answers.thing || ''}"`;
}

/**
 * Overrides the model on the one rule that needs no judgement.
 *
 * Whether a word starts with the target letter is mechanically decidable, so
 * there is no reason to trust a model for it — and models do get it wrong: a
 * strongly on-theme answer like "Tiger" under an India bonus was observed
 * scoring full marks for the letter S. Category validity and bonus matching
 * still need world knowledge, so those are left to the judge.
 */
export function enforceTargetLetter(
  verdict: JudgeVerdict,
  letter: string,
  answers: UserAnswers
): JudgeVerdict {
  const target = letter.trim().charAt(0).toUpperCase();
  const categories = { ...verdict.categories };
  let corrected = false;

  for (const key of CATEGORY_KEYS) {
    const word = (answers[key] || '').trim();
    const startsWithTarget = word.charAt(0).toUpperCase() === target;
    if (word && startsWithTarget) continue;

    const judged = categories[key];
    if (!judged.valid && !judged.bonusMatched) continue;

    corrected = true;
    categories[key] = {
      valid: false,
      bonusMatched: false,
      feedback: word
        ? `Must start with the letter "${target}".`
        : 'No answer provided.',
      // Keep the judge's suggestion only if it would itself have been accepted.
      suggestion:
        judged.suggestion && judged.suggestion.trim().charAt(0).toUpperCase() === target
          ? judged.suggestion
          : undefined,
    };
  }

  if (!corrected) return verdict;

  // The judge's own tally is no longer trustworthy once entries were corrected.
  const bonusMatches = CATEGORY_KEYS.filter((key) => categories[key].bonusMatched).length;

  return {
    ...verdict,
    categories,
    bonusChallengeMet: bonusMatches >= SCORING.bonusChallengeThreshold,
  };
}

/** Shapes a parsed response into a verdict. Transport failures are already handled. */
function toVerdict(parsed: any): JudgeVerdict {
  if (!parsed?.categories) {
    throw new Error('Azure judge returned no categories');
  }

  const categories = {} as Record<CategoryKey, CategoryJudgement>;
  for (const key of CATEGORY_KEYS) {
    const judged = parsed.categories[key];
    if (!judged) throw new Error(`Azure judge omitted category "${key}"`);

    categories[key] = {
      valid: Boolean(judged.valid),
      // bonusEvidence exists to shape generation, not to be shown; it is
      // deliberately not carried into the domain type.
      bonusMatched: Boolean(judged.valid) && Boolean(judged.bonusMatched),
      feedback: judged.feedback || '',
      suggestion: judged.suggestion || undefined,
    };
  }

  return {
    judgedBy: 'azure',
    categories,
    overallFeedback: parsed.overallFeedback || 'Great effort!',
    bonusChallengeMet: parsed.bonusChallengeMet,
  };
}

/**
 * Judge backed by a model deployed on Microsoft Foundry.
 *
 * `deployment` is the deployment name, which is what the API's `model`
 * parameter expects — not the underlying model name.
 */
export function createAzureJudge(client: OpenAI, deployment: string): Judge {
  const completer = createStructuredCompleter(client, deployment);

  async function judgeOnce(request: JudgeRequest): Promise<JudgeVerdict> {
    // Every transport concern — strict-mode wiring, refusals, truncation,
    // filter rejections, the parse — is handled by the completer. What is left
    // here is the domain: turning a parsed verdict into a judged round.
    const parsed = await completer.complete<any>({
      system: JUDGE_SYSTEM_PROMPT,
      user: buildUserPrompt(request),
      schemaName: 'round_verdict',
      schema: buildVerdictSchema(),
      temperature: 0.2,
    });

    return enforceTargetLetter(toVerdict(parsed), request.letter, request.answers);
  }

  /**
   * The filter rejects the whole prompt without saying which answer caused it,
   * so each non-empty answer is submitted alone to attribute the rejection.
   *
   * These are attribution probes, not retries: every probe carries different
   * content, and the original request is never repeated unchanged. They only
   * run on the rare filtered path.
   */
  async function attributeRejection(request: JudgeRequest): Promise<Set<CategoryKey>> {
    const blocked = new Set<CategoryKey>();

    for (const key of CATEGORY_KEYS) {
      if (!request.answers[key]?.trim()) continue;

      try {
        await judgeOnce(onlyCategory(request, key));
      } catch (err) {
        if (err instanceof ContentFilterError) blocked.add(key);
        // Any other failure here is not evidence of filtering; leave it unblocked.
      }
    }

    return blocked;
  }

  function allUnscoreable(): JudgeVerdict {
    const categories = {} as Record<CategoryKey, CategoryJudgement>;
    for (const key of CATEGORY_KEYS) categories[key] = { ...UNSCOREABLE };

    return {
      judgedBy: 'azure',
      categories,
      overallFeedback: "We couldn't check this round. Try different words.",
      bonusChallengeMet: false,
    };
  }

  async function judgeWithIsolation(request: JudgeRequest): Promise<JudgeVerdict> {
    const blocked = await attributeRejection(request);

    // Nothing attributable — the prompt as a whole tripped the filter, so no
    // answer can be judged. Better than blaming an arbitrary category.
    if (blocked.size === 0) return allUnscoreable();

    let verdict: JudgeVerdict;
    try {
      verdict = await judgeOnce(withoutCategories(request, blocked));
    } catch (err) {
      // Still filtered even with every blocked answer removed, so something
      // outside the answers is tripping it and nothing can be scored.
      if (err instanceof ContentFilterError) return allUnscoreable();
      throw err;
    }

    for (const key of blocked) verdict.categories[key] = { ...UNSCOREABLE };

    return verdict;
  }

  return {
    async judge(request: JudgeRequest): Promise<JudgeVerdict> {
      try {
        return await judgeOnce(request);
      } catch (err) {
        // A filtered round is handled here rather than falling through to the
        // heuristic, which would launder blocked content into a scored round.
        if (err instanceof ContentFilterError) return judgeWithIsolation(request);
        throw err;
      }
    },
  };
}
