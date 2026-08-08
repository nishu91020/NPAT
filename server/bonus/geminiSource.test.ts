import { GoogleGenAI } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { RENDERABLE_ICONS, createGeminiBonusSource } from './geminiSource';

function fakeAi(text: string): GoogleGenAI {
  return {
    models: { generateContent: async () => ({ text }) },
  } as unknown as GoogleGenAI;
}

const complete = {
  id: 'space_twist_S',
  title: 'Stellar Explorer',
  description: 'At least 2 answers must relate to space.',
  icon: 'Globe',
  ruleHint: 'Space themed.',
};

describe('createGeminiBonusSource', () => {
  it('passes through a well-formed challenge', async () => {
    const challenge = await createGeminiBonusSource(fakeAi(JSON.stringify(complete))).next('S');
    expect(challenge).toEqual(complete);
  });

  it('clamps an unrenderable icon to Sparkles', async () => {
    const challenge = await createGeminiBonusSource(
      fakeAi(JSON.stringify({ ...complete, icon: 'Compass' }))
    ).next('S');

    expect(challenge.icon).toBe('Sparkles');
  });

  it('only ever offers icons the UI can render', () => {
    expect(RENDERABLE_ICONS).not.toContain('Compass');
    expect(RENDERABLE_ICONS).not.toContain('Zap');
    expect(RENDERABLE_ICONS).not.toContain('Feather');
  });

  it('falls back to the title when ruleHint is missing', async () => {
    const { ruleHint, ...withoutHint } = complete;
    const challenge = await createGeminiBonusSource(fakeAi(JSON.stringify(withoutHint))).next('S');

    expect(challenge.ruleHint).toBe(complete.title);
  });

  it('throws on an incomplete challenge so the fallback engages', async () => {
    await expect(
      createGeminiBonusSource(fakeAi(JSON.stringify({ id: 'x' }))).next('S')
    ).rejects.toThrow();
  });
});
