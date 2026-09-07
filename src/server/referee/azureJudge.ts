import type OpenAI from 'openai';
import { CategoryKey } from '../../shared/contract';
import { ContentFilterError, createStructuredCompleter } from '../azure/jsonSchemaCompleter';
import { JUDGE_SYSTEM_PROMPT } from '../prompts';
import { CATEGORY_KEYS, SCORING } from './rules';
import {
  enforceTargetLetter,
  targetLetterOf,
  withOnlyMatchingLetters,
} from './roundGuardrails';
import { CategoryJudgement, Judge, JudgeRequest, JudgeVerdict } from './types';
import { UNSCOREABLE, onlyCategory, withoutCategories } from './contentFilter';

export { JUDGE_SYSTEM_PROMPT };

function categoryJudgementSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      valid: { type: 'boolean' },

      bonusEvidence: { type: 'string' },
      bonusMatched: { type: 'boolean' },
      feedback: { type: 'string' },
      suggestion: { type: 'string' },
    },

    required: ['valid', 'bonusEvidence', 'bonusMatched', 'feedback', 'suggestion'],
  };
}

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

export function createAzureJudge(client: OpenAI, deployment: string): Judge {
  const completer = createStructuredCompleter(client, deployment);

  async function judgeOnce(request: JudgeRequest): Promise<JudgeVerdict> {

    const scoreable = withOnlyMatchingLetters(request);

    const parsed = await completer.complete<any>({
      system: JUDGE_SYSTEM_PROMPT,
      user: buildUserPrompt(scoreable),
      schemaName: 'round_verdict',
      schema: buildVerdictSchema(),
      temperature: 0.2,
    });

    return enforceTargetLetter(toVerdict(parsed), request.letter, request.answers);
  }

  async function attributeRejection(request: JudgeRequest): Promise<Set<CategoryKey>> {
    const blocked = new Set<CategoryKey>();

    const scoreable = withOnlyMatchingLetters(request);

    for (const key of CATEGORY_KEYS) {
      if (!scoreable.answers[key]?.trim()) continue;

      try {
        await judgeOnce(onlyCategory(scoreable, key));
      } catch (err) {
        if (err instanceof ContentFilterError) blocked.add(key);

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

    if (blocked.size === 0) return allUnscoreable();

    let verdict: JudgeVerdict;
    try {
      verdict = await judgeOnce(withoutCategories(request, blocked));
    } catch (err) {

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

        if (err instanceof ContentFilterError) return judgeWithIsolation(request);
        throw err;
      }
    },
  };
}
