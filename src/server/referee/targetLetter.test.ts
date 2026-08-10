import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { BonusChallenge } from '../../shared/contract';
import { createAzureJudge } from './azureJudge';
import { enforceTargetLetter, startsWithTargetLetter, withOnlyMatchingLetters } from './targetLetter';
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

  it('states the letter rule as the reason a wrong-letter answer failed', () => {
    // The judge never saw "Zzzz" — it was withheld — so its reason describes a
    // blank. The player is told the rule their word actually broke.
    const corrected = enforceTargetLetter(overGenerousVerdict(), 'S', answers);

    expect(corrected.categories.thing.valid).toBe(false);
    expect(corrected.categories.thing.feedback).toBe('Must start with the letter "S".');
  });

  it("keeps the judge's reason for a matching answer it rejected", () => {
    const verdict = overGenerousVerdict();
    verdict.categories.thing.feedback = 'Sqwrl is not a thing.';

    const corrected = enforceTargetLetter(verdict, 'S', { ...answers, thing: 'Sqwrl' });

    expect(corrected.categories.thing.valid).toBe(false);
    expect(corrected.categories.thing.feedback).toBe('Sqwrl is not a thing.');
  });

  it('leaves a blank the judge already failed exactly as it is', () => {
    const verdict = overGenerousVerdict();
    verdict.categories.animal = {
      valid: false,
      bonusMatched: false,
      feedback: 'No answer provided.',
    };

    expect(enforceTargetLetter(verdict, 'S', { ...answers, animal: '', thing: 'Spoon' })).toBe(
      verdict
    );
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

describe('startsWithTargetLetter', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(startsWithTargetLetter('  lizabeth ', 'L')).toBe(true);
    expect(startsWithTargetLetter('Lizabeth', 'l')).toBe(true);
  });

  it('rejects a blank answer', () => {
    expect(startsWithTargetLetter('   ', 'L')).toBe(false);
    expect(startsWithTargetLetter('', 'L')).toBe(false);
  });

  it('rejects a word starting with another letter', () => {
    expect(startsWithTargetLetter('Tiger', 'S')).toBe(false);
  });
});

describe('withOnlyMatchingLetters', () => {
  const request = {
    letter: 'S',
    answers: { name: '  Sarah ', place: 'Tokyo', animal: 'Shark', thing: '' },
    bonusChallenge: bonus,
  };

  it('withholds a wrong-letter answer, so the judge cannot rule on the letter', () => {
    expect(withOnlyMatchingLetters(request).answers.place).toBe('');
  });

  it('trims what it passes on, so stray whitespace is never the first character', () => {
    // Observed live: an untrimmed answer reads as starting with a space.
    expect(withOnlyMatchingLetters(request).answers.name).toBe('Sarah');
  });

  it('leaves a matching answer and the rest of the round alone', () => {
    const filtered = withOnlyMatchingLetters(request);

    expect(filtered.answers.animal).toBe('Shark');
    expect(filtered.letter).toBe('S');
    expect(filtered.bonusChallenge).toBe(bonus);
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

  it('never shows the model a wrong-letter answer, so it cannot fail one on the letter', async () => {
    const create = vi.fn(async (_args: any) => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              categories: {
                name: { valid: true, bonusMatched: false, feedback: 'ok' },
                place: { valid: true, bonusMatched: false, feedback: 'ok' },
                animal: { valid: false, bonusMatched: false, feedback: 'No answer provided.' },
                thing: { valid: true, bonusMatched: false, feedback: 'ok' },
              },
              overallFeedback: 'Nice',
              bonusChallengeMet: false,
            }),
          },
          finish_reason: 'stop',
        },
      ],
    }));
    const client = { chat: { completions: { create } } } as unknown as OpenAI;

    // Observed live: the model failed "Lizabeth" for the letter L, reporting a
    // first-letter mismatch on a word that plainly starts with L.
    const verdict = await createAzureJudge(client, 'npat-judge').judge({
      letter: 'L',
      answers: { name: ' Lizabeth', place: 'London', animal: 'Tiger', thing: 'Lamp' },
      bonusChallenge: bonus,
    });

    const prompt = (create.mock.calls[0][0] as any).messages[1].content;
    expect(prompt).toContain('"Lizabeth"');
    expect(prompt).not.toContain('Tiger');
    expect(verdict.categories.name.valid).toBe(true);
    expect(verdict.categories.animal.feedback).toBe('Must start with the letter "L".');
  });
});
