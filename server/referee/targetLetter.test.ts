import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { BonusChallenge } from '../../src/types';
import { createAzureJudge, enforceTargetLetter } from './azureJudge';
import { JudgeVerdict } from './types';

const bonus: BonusChallenge = {
  id: 'india_focus',
  title: 'India Connection',
  description: 'At least 2 answers must have a connection to India or South Asia.',
  icon: 'Flag',
  ruleHint: 'Indian names, places, wildlife or cultural items.',
};

/** The verdict actually observed from a live model: Tiger passed for "S". */
function overGenerousVerdict(): JudgeVerdict {
  const pass = (feedback: string) => ({ valid: true, bonusMatched: true, feedback });

  return {
    judgedBy: 'azure',
    categories: {
      name: pass('Shivaji, legendary Indian warrior king.'),
      place: pass('Srinagar, beautiful city in Kashmir, India.'),
      animal: pass("Tiger, India's national animal."),
      thing: { valid: false, bonusMatched: false, feedback: 'Zzzz is not a thing.' },
    },
    overallFeedback: 'Strong India links!',
    bonusChallengeMet: true,
  };
}

const answers = { name: 'Shivaji', place: 'Srinagar', animal: 'Tiger', thing: 'Zzzz' };

describe('enforceTargetLetter', () => {
  it('overrules the model when an answer starts with the wrong letter', () => {
    // Observed live: a strongly on-theme answer beat the letter rule.
    const corrected = enforceTargetLetter(overGenerousVerdict(), 'S', answers);

    expect(corrected.categories.animal.valid).toBe(false);
    expect(corrected.categories.animal.bonusMatched).toBe(false);
    expect(corrected.categories.animal.feedback).toBe('Must start with the letter "S".');
  });

  it('leaves correct answers untouched', () => {
    const corrected = enforceTargetLetter(overGenerousVerdict(), 'S', answers);

    expect(corrected.categories.name).toEqual({
      valid: true,
      bonusMatched: true,
      feedback: 'Shivaji, legendary Indian warrior king.',
    });
  });

  it('recomputes bonusChallengeMet, since the model tallied a corrected entry', () => {
    const verdict = overGenerousVerdict();
    verdict.categories.place = { valid: true, bonusMatched: false, feedback: 'x' };

    // Only name legitimately matches once Tiger is overruled — below the threshold of 2.
    const corrected = enforceTargetLetter(verdict, 'S', answers);

    expect(corrected.bonusChallengeMet).toBe(false);
  });

  it('is case-insensitive', () => {
    const corrected = enforceTargetLetter(overGenerousVerdict(), 's', {
      ...answers,
      animal: 'shark',
    });

    expect(corrected.categories.animal.valid).toBe(true);
  });

  it('overrules an empty answer the model marked valid', () => {
    const corrected = enforceTargetLetter(overGenerousVerdict(), 'S', { ...answers, animal: '' });

    expect(corrected.categories.animal.valid).toBe(false);
    expect(corrected.categories.animal.feedback).toBe('No answer provided.');
  });

  it('ignores leading whitespace when checking the letter', () => {
    const corrected = enforceTargetLetter(overGenerousVerdict(), 'S', {
      ...answers,
      animal: '  Snake',
    });

    expect(corrected.categories.animal.valid).toBe(true);
  });

  it('returns the verdict unchanged when the model got everything right', () => {
    const verdict = overGenerousVerdict();
    const good = { name: 'Sarah', place: 'Spain', animal: 'Shark', thing: 'Spoon' };

    expect(enforceTargetLetter(verdict, 'S', good)).toBe(verdict);
  });

  it('does not resurrect an answer the model already rejected', () => {
    const corrected = enforceTargetLetter(overGenerousVerdict(), 'S', answers);

    expect(corrected.categories.thing.valid).toBe(false);
    expect(corrected.categories.thing.feedback).toBe('Zzzz is not a thing.');
  });

  describe('suggestions survive correction only if they would themselves pass', () => {
    it('keeps a suggestion that starts with the target letter', () => {
      const verdict = overGenerousVerdict();
      verdict.categories.animal.suggestion = 'Snake';

      const corrected = enforceTargetLetter(verdict, 'S', answers);

      expect(corrected.categories.animal.suggestion).toBe('Snake');
    });

    it('drops a suggestion that would itself have been rejected', () => {
      const verdict = overGenerousVerdict();
      verdict.categories.animal.suggestion = 'Elephant';

      const corrected = enforceTargetLetter(verdict, 'S', answers);

      expect(corrected.categories.animal.suggestion).toBeUndefined();
    });
  });
});

describe('createAzureJudge applies the letter rule', () => {
  it('corrects a wrong-letter answer the model let through', async () => {
    const create = vi.fn(async (_args: any) => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              categories: {
                name: { valid: true, bonusMatched: true, feedback: 'ok' },
                place: { valid: true, bonusMatched: true, feedback: 'ok' },
                animal: { valid: true, bonusMatched: true, feedback: "India's national animal." },
                thing: { valid: true, bonusMatched: true, feedback: 'ok' },
              },
              overallFeedback: 'Nice',
              bonusChallengeMet: true,
            }),
          },
          finish_reason: 'stop',
        },
      ],
    }));
    const client = { chat: { completions: { create } } } as unknown as OpenAI;

    const verdict = await createAzureJudge(client, 'npat-judge').judge({
      letter: 'S',
      answers: { name: 'Sarah', place: 'Spain', animal: 'Tiger', thing: 'Spoon' },
      bonusChallenge: bonus,
    });

    expect(verdict.categories.animal.valid).toBe(false);
    expect(verdict.categories.name.valid).toBe(true);
  });
});
