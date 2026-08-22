import { describe, expect, it } from 'vitest';
import { BONUS_CHALLENGES, DETERMINISTIC_CHALLENGE_COUNT } from './bonusChallenges';
import { getDailyPuzzleData, getRandomPuzzleData } from './puzzle';

const FROZEN = [
  { date: '2026-01-01', letter: 'P', challengeId: 'famous_name', dayNumber: 1 },
  { date: '2026-03-15', letter: 'N', challengeId: 'world_place', dayNumber: 74 },
  { date: '2026-08-10', letter: 'K', challengeId: 'edible_thing', dayNumber: 222 },
  { date: '2026-08-11', letter: 'L', challengeId: 'edible_thing', dayNumber: 223 },
  { date: '2026-12-25', letter: 'O', challengeId: 'world_place', dayNumber: 359 },
  { date: '2027-06-30', letter: 'F', challengeId: 'world_place', dayNumber: 546 },
];

describe('getDailyPuzzleData', () => {
  it.each(FROZEN)('derives $date exactly as it always has', (expected) => {
    const puzzle = getDailyPuzzleData(expected.date);

    expect(puzzle.letter).toBe(expected.letter);
    expect(puzzle.bonusChallenge.id).toBe(expected.challengeId);
    expect(puzzle.dayNumber).toBe(expected.dayNumber);
  });

  it('is stable across calls', () => {
    expect(getDailyPuzzleData('2026-04-04')).toEqual(getDailyPuzzleData('2026-04-04'));
  });

  it('only ever picks from the frozen prefix', () => {
    const frozenIds = BONUS_CHALLENGES.slice(0, DETERMINISTIC_CHALLENGE_COUNT).map((c) => c.id);

    for (let day = 0; day < 365; day++) {
      const date = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString().split('T')[0];

      expect(frozenIds).toContain(getDailyPuzzleData(date).bonusChallenge.id);
    }
  });

  it('keeps the frozen prefix in its original order', () => {

    expect(BONUS_CHALLENGES.slice(0, DETERMINISTIC_CHALLENGE_COUNT).map((c) => c.id)).toEqual([
      'long_words',
      'india_focus',
      'edible_thing',
      'world_place',
      'wildlife_expert',
      'vowel_rich',
      'famous_name',
    ]);
  });
});

describe('getRandomPuzzleData', () => {
  it('draws from the whole pool, including the appended challenges', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 800; i++) seen.add(getRandomPuzzleData().bonusChallenge.id);

    expect(seen.size).toBe(BONUS_CHALLENGES.length);
  });

  it('never repeats the letter the player just had', () => {
    for (let i = 0; i < 100; i++) {
      expect(getRandomPuzzleData('S').letter).not.toBe('S');
    }
  });
});
