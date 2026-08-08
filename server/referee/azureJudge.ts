import type OpenAI from 'openai';
import { CategoryKey } from '../../src/types';
import { CATEGORY_KEYS, SCORING } from './scoring';
import { CategoryJudgement, Judge, JudgeRequest, JudgeVerdict } from './types';

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
      bonusMatched: { type: 'boolean' },
      feedback: { type: 'string' },
    },
    // Strict mode requires every property to be listed.
    required: ['valid', 'bonusMatched', 'feedback'],
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

For each of the four categories you receive, decide:
1. Target Letter: does the word strictly start with the target letter (case-insensitive)? If not, or if empty, valid = false and bonusMatched = false.
2. Category Validity: is the word a real, recognized item fitting the category?
   - "Name": genuine human first name or famous character.
   - "Place": real city, country, state, river, mountain, or landmark.
   - "Animal": real animal species, bird, fish, reptile, insect, etc.
   - "Thing": real physical object, item, tool, food, vehicle, element, etc.
3. Bonus Match: does this entry fulfil the active bonus rule you are given?
4. Feedback: witty and concise, maximum 10 words per category.

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

function parseVerdict(raw: string): JudgeVerdict {
  const parsed = JSON.parse(raw);
  if (!parsed?.categories) {
    throw new Error('Azure judge returned no categories');
  }

  const categories = {} as Record<CategoryKey, CategoryJudgement>;
  for (const key of CATEGORY_KEYS) {
    const judged = parsed.categories[key];
    if (!judged) throw new Error(`Azure judge omitted category "${key}"`);

    categories[key] = {
      valid: Boolean(judged.valid),
      bonusMatched: Boolean(judged.bonusMatched),
      feedback: judged.feedback || '',
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
  return {
    async judge(request: JudgeRequest): Promise<JudgeVerdict> {
      const response = await client.chat.completions.create({
        model: deployment,
        temperature: 0.2,
        messages: [
          { role: 'system', content: JUDGE_SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(request) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'round_verdict',
            strict: true,
            schema: buildVerdictSchema(),
          },
        },
      });

      const choice = response.choices?.[0];
      if (!choice) throw new Error('Azure judge returned no choices');

      if (choice.message?.refusal) {
        throw new Error(`Azure judge refused: ${choice.message.refusal}`);
      }

      if (choice.finish_reason === 'content_filter') {
        throw new Error('Azure judge response was filtered');
      }

      if (choice.finish_reason === 'length') {
        throw new Error('Azure judge response was truncated');
      }

      const content = choice.message?.content;
      if (!content) throw new Error('Azure judge returned empty content');

      return parseVerdict(content);
    },
  };
}
