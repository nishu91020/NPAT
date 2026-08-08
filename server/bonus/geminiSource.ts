import { GoogleGenAI, Type } from '@google/genai';
import { BonusChallenge } from '../../src/types';
import { BonusChallengeSource } from './types';

/**
 * Icons the UI can actually render. Kept in lockstep with ICON_MAP in
 * LetterBanner.tsx — anything outside this list falls back to Sparkles, so the
 * model is only ever offered icons that exist.
 */
export const RENDERABLE_ICONS = [
  'Sparkles',
  'Flag',
  'Utensils',
  'Globe',
  'TreePine',
  'Layers',
  'Award',
] as const;

const bonusChallengeSchema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    icon: { type: Type.STRING, enum: [...RENDERABLE_ICONS] },
    ruleHint: { type: Type.STRING },
  },
  required: ['id', 'title', 'description', 'icon', 'ruleHint'],
};

function buildPrompt(letter: string): string {
  const target = letter.toUpperCase();

  return `You are an expert game designer for the word puzzle "Name, Place, Animal, Thing".
Generate ONE unique, creative, real-time Bonus Challenge rule for the target letter "${target}".
The bonus challenge must give players a fun extra objective (e.g., words related to nature, food/drinks, travel/geography, science/space, history, double vowels, 5+ letters, or specific themes).

Return JSON matching the schema:
- id: a short slug string (e.g. "space_twist_${target}")
- title: catchy title max 25 characters (e.g. "Stellar Explorer")
- description: clear rule instruction max 85 characters (e.g. "At least 2 answers must relate to space, science, or stars.")
- icon: must be one of [${RENDERABLE_ICONS.map((i) => `'${i}'`).join(', ')}]
- ruleHint: ultra concise hint max 35 characters`;
}

export function createGeminiBonusSource(
  ai: GoogleGenAI,
  model = 'gemini-3.6-flash'
): BonusChallengeSource {
  return {
    async next(letter: string): Promise<BonusChallenge> {
      const response = await ai.models.generateContent({
        model,
        contents: buildPrompt(letter),
        config: {
          temperature: 0.8,
          responseMimeType: 'application/json',
          responseSchema: bonusChallengeSchema,
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      if (!parsed.title || !parsed.description) {
        throw new Error('Gemini returned an incomplete bonus challenge');
      }

      const icon = RENDERABLE_ICONS.includes(parsed.icon) ? parsed.icon : 'Sparkles';

      return {
        id: parsed.id || `realtime_${letter.toUpperCase()}_${Date.now()}`,
        title: parsed.title,
        description: parsed.description,
        icon,
        ruleHint: parsed.ruleHint || parsed.title,
      };
    },
  };
}
