import { GoogleGenAI } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { BonusChallenge } from '../../src/types';
import { createGeminiJudge } from './geminiJudge';

const bonus: BonusChallenge = {
  id: 'long_words',
  title: 'Super Size Words',
  description: 'All 4 answers must be at least 5 letters long.',
  icon: 'Sparkles',
  ruleHint: 'Words must contain 5+ letters.',
};

const request = {
  letter: 'S',
  answers: { name: 'Sarah', place: 'Spain', animal: 'Shark', thing: 'Spoon' },
  bonusChallenge: bonus,
};

/** Stands in for the Gemini client so the adapter is testable without a network. */
function fakeAi(text: string): GoogleGenAI {
  return {
    models: { generateContent: async () => ({ text }) },
  } as unknown as GoogleGenAI;
}

function fullResponse(over: Record<string, unknown> = {}) {
  const category = { valid: true, bonusMatched: true, feedback: 'Nice' };
  return JSON.stringify({
    categories: { name: category, place: category, animal: category, thing: category },
    overallFeedback: 'Well played',
    bonusChallengeMet: true,
    ...over,
  });
}

describe('createGeminiJudge', () => {
  it('parses a well-formed response and claims the gemini identity', async () => {
    const verdict = await createGeminiJudge(fakeAi(fullResponse())).judge(request);

    expect(verdict.judgedBy).toBe('gemini');
    expect(verdict.overallFeedback).toBe('Well played');
    expect(verdict.bonusChallengeMet).toBe(true);
    expect(verdict.categories.name).toEqual({
      valid: true,
      bonusMatched: true,
      feedback: 'Nice',
    });
  });

  it('never returns points, so the model cannot invent a score', async () => {
    const verdict = await createGeminiJudge(
      fakeAi(
        JSON.stringify({
          categories: {
            name: { valid: true, bonusMatched: true, feedback: 'x', points: 9999 },
            place: { valid: true, bonusMatched: false, feedback: 'x' },
            animal: { valid: true, bonusMatched: false, feedback: 'x' },
            thing: { valid: true, bonusMatched: false, feedback: 'x' },
          },
        })
      )
    ).judge(request);

    expect(verdict.categories.name).not.toHaveProperty('points');
  });

  it('coerces loose truthiness into real booleans', async () => {
    const verdict = await createGeminiJudge(
      fakeAi(
        JSON.stringify({
          categories: {
            name: { valid: 'yes', bonusMatched: 0, feedback: 'x' },
            place: { valid: true, bonusMatched: false, feedback: 'x' },
            animal: { valid: true, bonusMatched: false, feedback: 'x' },
            thing: { valid: true, bonusMatched: false, feedback: 'x' },
          },
        })
      )
    ).judge(request);

    expect(verdict.categories.name.valid).toBe(true);
    expect(verdict.categories.name.bonusMatched).toBe(false);
  });

  it('defaults missing feedback rather than emitting undefined', async () => {
    const verdict = await createGeminiJudge(
      fakeAi(
        JSON.stringify({
          categories: {
            name: { valid: true, bonusMatched: false },
            place: { valid: true, bonusMatched: false },
            animal: { valid: true, bonusMatched: false },
            thing: { valid: true, bonusMatched: false },
          },
        })
      )
    ).judge(request);

    expect(verdict.categories.name.feedback).toBe('');
    expect(verdict.overallFeedback).toBe('Great effort!');
  });

  it('throws on an empty response so the fallback engages', async () => {
    await expect(createGeminiJudge(fakeAi('{}')).judge(request)).rejects.toThrow();
  });

  it('throws when a category is missing rather than scoring a partial round', async () => {
    const partial = JSON.stringify({
      categories: { name: { valid: true, bonusMatched: false, feedback: 'x' } },
    });

    await expect(createGeminiJudge(fakeAi(partial)).judge(request)).rejects.toThrow(
      /omitted category/
    );
  });

  it('throws on unparseable output', async () => {
    await expect(createGeminiJudge(fakeAi('not json')).judge(request)).rejects.toThrow();
  });
});
