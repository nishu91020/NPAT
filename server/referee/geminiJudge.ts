import { GoogleGenAI, Type } from '@google/genai';
import { CategoryKey } from '../../src/types';
import { Judge, JudgeRequest, JudgeVerdict } from './types';
import { SCORING } from './scoring';

/**
 * One category schema, reused for all four categories. Note the absence of
 * `points`: the referee derives them, so the model cannot invent a score.
 */
const categoryJudgementSchema = {
  type: Type.OBJECT,
  properties: {
    valid: { type: Type.BOOLEAN },
    bonusMatched: { type: Type.BOOLEAN },
    feedback: { type: Type.STRING },
  },
  required: ['valid', 'bonusMatched', 'feedback'],
};

const verdictSchema = {
  type: Type.OBJECT,
  properties: {
    categories: {
      type: Type.OBJECT,
      properties: {
        name: categoryJudgementSchema,
        place: categoryJudgementSchema,
        animal: categoryJudgementSchema,
        thing: categoryJudgementSchema,
      },
      required: ['name', 'place', 'animal', 'thing'],
    },
    overallFeedback: { type: Type.STRING },
    bonusChallengeMet: { type: Type.BOOLEAN },
  },
  required: ['categories', 'overallFeedback', 'bonusChallengeMet'],
};

function buildPrompt({ letter, answers, bonusChallenge }: JudgeRequest): string {
  const target = letter.toUpperCase();

  return `You are the ultimate fun, fair, and precise AI referee for the classic word puzzle game "Name, Place, Animal, Thing".
Target letter: "${target}".
Active Bonus Challenge: "${bonusChallenge?.title || 'Bonus'}: ${bonusChallenge?.description || 'Extra points for valid entries'}".

User Answers to evaluate:
- Name: "${answers.name || ''}"
- Place: "${answers.place || ''}"
- Animal: "${answers.animal || ''}"
- Thing: "${answers.thing || ''}"

Evaluation Rules:
1. Target Letter: Does the word strictly start with "${target}" (case-insensitive)? If not, or if empty, valid = false and bonusMatched = false.
2. Category Validity: Is the word a real, recognized item fitting the category?
   - "Name": Genuine human first name or famous character.
   - "Place": Real city, country, state, river, mountain, or landmark.
   - "Animal": Real animal species, bird, fish, reptile, insect, etc.
   - "Thing": Real physical object, item, tool, food, vehicle, element, etc.
3. Bonus Match: Does this entry fulfill the active bonus rule ("${bonusChallenge?.description}")?
4. Provide witty, concise feedback (max 10 words) for each category.
5. Set bonusChallengeMet to true when at least ${SCORING.bonusChallengeThreshold} categories satisfy the bonus rule.

Do not assign points. Scoring is applied separately.
Return JSON adhering strictly to the response schema.`;
}

/**
 * Gemini-backed judge. Takes an initialised client rather than constructing one,
 * so tests and callers control the dependency.
 */
export function createGeminiJudge(ai: GoogleGenAI, model = 'gemini-3.6-flash'): Judge {
  return {
    async judge(request: JudgeRequest): Promise<JudgeVerdict> {
      const response = await ai.models.generateContent({
        model,
        contents: buildPrompt(request),
        config: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: verdictSchema,
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      if (!parsed?.categories) {
        throw new Error('Gemini returned no categories');
      }

      const categories = {} as JudgeVerdict['categories'];
      for (const key of ['name', 'place', 'animal', 'thing'] as CategoryKey[]) {
        const judged = parsed.categories[key];
        if (!judged) throw new Error(`Gemini omitted category "${key}"`);

        categories[key] = {
          valid: Boolean(judged.valid),
          bonusMatched: Boolean(judged.bonusMatched),
          feedback: judged.feedback || '',
        };
      }

      return {
        judgedBy: 'gemini',
        categories,
        overallFeedback: parsed.overallFeedback || 'Great effort!',
        bonusChallengeMet: parsed.bonusChallengeMet,
      };
    },
  };
}
