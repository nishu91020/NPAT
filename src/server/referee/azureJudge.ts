import type OpenAI from 'openai';
import { CategoryKey, UserAnswers } from '../../shared/contract';
import { ContentFilterError, createStructuredCompleter } from '../azure/structuredCompletion';
import { CATEGORY_KEYS, SCORING } from './scoring';
import { enforceTargetLetter, targetLetterOf, withOnlyMatchingLetters } from './targetLetter';
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

THE FIRST LETTER IS NOT YOURS TO JUDGE. Every answer you receive has already been checked mechanically against the target letter, and any answer that failed that check has been replaced with an empty string before it reached you. So never reject an answer because of the letter it starts with, and never mention the first letter as a reason. If an answer is present, treat it as starting with the target letter, however it looks to you.

For each of the four categories you receive, decide:
1. Category Validity: is the word a real, recognized item fitting the category?
   - "Name": genuine human first name, in any language or spelling variant, or a famous character.
   - "Place": real city, country, state, river, mountain, or landmark.
   - "Animal": real animal species, bird, fish, reptile, insect, etc.
   - "Thing": real physical object, item, tool, food, vehicle, element, etc.
   An empty answer is worth nothing: valid = false and bonusMatched = false.
2. bonusEvidence: state in a few words whether this specific answer satisfies the active bonus rule, and why. Write this BEFORE deciding bonusMatched.
3. bonusMatched: set it to exactly what your bonusEvidence just said. If the evidence says the answer does not satisfy the rule, bonusMatched MUST be false. Never contradict your own evidence. When in doubt, use false. If the answer is not valid, bonusMatched must be false.
4. feedback: witty and concise, maximum 10 words. It must agree with valid and bonusMatched, and must say nothing about the first letter.
5. suggestion: ONE example answer that would have scored better. Give one in BOTH of these cases:
   - valid is false — the answer was not a real member of the category;
   - valid is true but bonusMatched is false — the answer was fine, but it missed the Bonus Challenge. This is the case players learn the most from, so do not skip it: show the word that would have earned the bonus.
   Whichever case it is, the word must satisfy ALL THREE of: a genuine member of that same category, starts with the target letter, and satisfies the active Bonus Challenge rule. A suggestion that breaks any of them will be discarded, so use an empty string rather than a guess. Just the word, nothing else.
   NEVER invent, misspell or pad a word to make it satisfy the rule. "Samm" is not a name and "Spoonn" is not a thing; a made-up word is a worse answer than the player's own. If no real answer of that category satisfies the rule, use an empty string — saying nothing is always allowed.
   Use an empty string when valid is true and bonusMatched is true — there is nothing to improve — and when the Bonus Challenge names a different category, since a rule naming one category asks nothing of the other three and no answer here could have earned it.

Set bonusChallengeMet to true when at least ${SCORING.bonusChallengeThreshold} categories satisfy the bonus rule.

Do not assign points. Scoring is applied separately.`;

/** The per-round data. Everything variable lives here, after the cacheable prefix. */
export function buildUserPrompt({ letter, answers, bonusChallenge }: JudgeRequest): string {
  const target = targetLetterOf(letter);
  const shown = (key: CategoryKey) => (answers[key] || '').trim();

  return `Target letter: "${target}".
Active Bonus Challenge: "${bonusChallenge?.title || 'Bonus'}: ${bonusChallenge?.description || 'Extra points for valid entries'}".

Answers to evaluate:
- Name: "${shown('name')}"
- Place: "${shown('place')}"
- Animal: "${shown('animal')}"
- Thing: "${shown('thing')}"`;
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
      suggestion: judged.suggestion?.trim() || undefined,
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
    // The letter rule is settled here, not by the model: wrong-letter answers
    // are withheld from it, and the ruling on them is applied afterwards from
    // the player's own words. Left to the model, the check failed both ways.
    const scoreable = withOnlyMatchingLetters(request);

    // Every transport concern — strict-mode wiring, refusals, truncation,
    // filter rejections, the parse — is handled by the completer. What is left
    // here is the domain: turning a parsed verdict into a judged round.
    const parsed = await completer.complete<any>({
      system: JUDGE_SYSTEM_PROMPT,
      user: buildUserPrompt(scoreable),
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
    // Wrong-letter answers never reach the model, so they cannot be what it
    // refused; probing them would only spend a call to learn nothing.
    const scoreable = withOnlyMatchingLetters(request);

    for (const key of CATEGORY_KEYS) {
      if (!scoreable.answers[key]?.trim()) continue;

      try {
        await judgeOnce(onlyCategory(scoreable, key));
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
