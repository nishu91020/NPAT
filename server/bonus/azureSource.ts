import type OpenAI from 'openai';
import { BonusChallenge } from '../../src/types';
import { BonusChallengeSource } from './types';
import { RENDERABLE_ICONS } from './icons';

export { RENDERABLE_ICONS };

/**
 * Strict mode cannot express maxLength, so the character limits stay as prompt
 * instructions and the parser stays defensive about what comes back.
 */
export function buildBonusSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      icon: { type: 'string', enum: [...RENDERABLE_ICONS] },
      ruleHint: { type: 'string' },
    },
    required: ['id', 'title', 'description', 'icon', 'ruleHint'],
  };
}

export const BONUS_SYSTEM_PROMPT = `You are an expert game designer for the word puzzle "Name, Place, Animal, Thing".

Generate ONE unique, creative Bonus Challenge rule for the target letter you are given. The challenge must give players a fun extra objective — for example words related to nature, food and drink, travel and geography, science and space, history, double vowels, longer words, or a specific theme.

Constraints:
- id: a short slug string
- title: catchy, maximum 25 characters
- description: a clear rule instruction, maximum 85 characters
- icon: one of [${RENDERABLE_ICONS.map((i) => `'${i}'`).join(', ')}]
- ruleHint: ultra concise hint, maximum 35 characters`;

export function buildBonusUserPrompt(letter: string): string {
  return `Target letter: "${letter.toUpperCase()}".`;
}

/**
 * Bonus challenge generator backed by a model deployed on Microsoft Foundry.
 *
 * `deployment` is the deployment name, which is what the API's `model`
 * parameter expects — not the underlying model name.
 */
export function createAzureBonusSource(
  client: OpenAI,
  deployment: string
): BonusChallengeSource {
  return {
    async next(letter: string): Promise<BonusChallenge> {
      const response = await client.chat.completions.create({
        model: deployment,
        temperature: 0.8,
        messages: [
          { role: 'system', content: BONUS_SYSTEM_PROMPT },
          { role: 'user', content: buildBonusUserPrompt(letter) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'bonus_challenge',
            strict: true,
            schema: buildBonusSchema(),
          },
        },
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) throw new Error('Azure bonus source returned empty content');

      const parsed = JSON.parse(content);
      if (!parsed.title || !parsed.description) {
        throw new Error('Azure bonus source returned an incomplete challenge');
      }

      // The schema constrains this, but the clamp stays: the UI can only render
      // these seven icons, whatever the model sends.
      const icon = RENDERABLE_ICONS.includes(parsed.icon) ? parsed.icon : 'Sparkles';

      return {
        id: parsed.id || `azure_${letter.toUpperCase()}_${Date.now()}`,
        title: parsed.title,
        description: parsed.description,
        icon,
        ruleHint: parsed.ruleHint || parsed.title,
      };
    },
  };
}
