import { describe, expect, it } from 'vitest';
import { BonusChallenge, UserAnswers } from '../../src/types';
import { heuristicJudge } from './heuristicJudge';

function challenge(id: string): BonusChallenge {
  return { id, title: id, description: id, icon: 'Sparkles', ruleHint: id };
}

function answers(over: Partial<UserAnswers> = {}): UserAnswers {
  return { name: '', place: '', animal: '', thing: '', ...over };
}

async function judge(letter: string, given: Partial<UserAnswers>, bonusId = 'long_words') {
  return heuristicJudge.judge({
    letter,
    answers: answers(given),
    bonusChallenge: challenge(bonusId),
  });
}

describe('heuristicJudge', () => {
  it('identifies itself as the heuristic', async () => {
    const verdict = await judge('S', { name: 'Sarah' });
    expect(verdict.judgedBy).toBe('heuristic');
  });

  it('rejects an empty answer', async () => {
    const verdict = await judge('S', { name: '' });
    expect(verdict.categories.name).toMatchObject({ valid: false, bonusMatched: false });
    expect(verdict.categories.name.feedback).toBe('No answer provided.');
  });

  it('rejects an answer starting with the wrong letter', async () => {
    const verdict = await judge('S', { animal: 'Tiger' });
    expect(verdict.categories.animal.valid).toBe(false);
    expect(verdict.categories.animal.feedback).toContain('Must start with the letter "S"');
  });

  it('matches the target letter case-insensitively', async () => {
    const verdict = await judge('s', { animal: 'shark' });
    expect(verdict.categories.animal.valid).toBe(true);
  });

  it('ignores surrounding whitespace', async () => {
    const verdict = await judge('S', { thing: '   Spoon  ' });
    expect(verdict.categories.thing.valid).toBe(true);
  });

  it('rejects a single character as too short', async () => {
    const verdict = await judge('S', { name: 'S' });
    expect(verdict.categories.name.valid).toBe(false);
  });

  describe('bonus rules it can verify', () => {
    it('awards long_words only at five characters or more', async () => {
      const long = await judge('S', { name: 'Sarah' }, 'long_words');
      expect(long.categories.name.bonusMatched).toBe(true);

      const short = await judge('S', { name: 'Sam' }, 'long_words');
      expect(short.categories.name.valid).toBe(true);
      expect(short.categories.name.bonusMatched).toBe(false);
    });

    it('awards vowel_rich only with two or more vowels', async () => {
      const rich = await judge('S', { place: 'Seattle' }, 'vowel_rich');
      expect(rich.categories.place.bonusMatched).toBe(true);

      const poor = await judge('S', { place: 'Sky' }, 'vowel_rich');
      expect(poor.categories.place.valid).toBe(true);
      expect(poor.categories.place.bonusMatched).toBe(false);
    });
  });

  describe('bonus rules requiring world knowledge', () => {
    it.each(['india_focus', 'famous_name', 'edible_thing', 'world_place', 'wildlife_expert'])(
      'declines to award %s rather than guessing',
      async (id) => {
        const verdict = await judge(
          'S',
          { name: 'Sarah', place: 'Spain', animal: 'Shark', thing: 'Samosa' },
          id
        );

        for (const category of Object.values(verdict.categories)) {
          expect(category.valid).toBe(true);
          expect(category.bonusMatched).toBe(false);
        }
      }
    );
  });

  it('judges each category independently', async () => {
    const verdict = await judge('S', {
      name: 'Sarah',
      place: 'Tokyo',
      animal: '',
      thing: 'Spoon',
    });

    expect(verdict.categories.name.valid).toBe(true);
    expect(verdict.categories.place.valid).toBe(false);
    expect(verdict.categories.animal.valid).toBe(false);
    expect(verdict.categories.thing.valid).toBe(true);
  });
});
