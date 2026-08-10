import { describe, expect, it } from 'vitest';
import {
  BONUS_CHALLENGES,
  DETERMINISTIC_CHALLENGE_COUNT,
  getDailyPuzzleData,
  getRandomPuzzleData,
} from './puzzle';

/**
 * Captured from the derivation before the built-in pool was widened. The daily
 * puzzle for a past date must never change, so these are goldens, not
 * expectations to be updated when the code moves.
 */
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

    // A year of dates: appending a challenge must not leak into any of them.
    for (let day = 0; day < 365; day++) {
      const date = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString().split('T')[0];

      expect(frozenIds).toContain(getDailyPuzzleData(date).bonusChallenge.id);
    }
  });

  it('keeps the frozen prefix in its original order', () => {
    // Reordering these silently rewrites every past puzzle, which no test
    // downstream of the index would catch.
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

describe('the built-in challenge pool', () => {
  it('is wide enough that the no-AI fallback does not feel repetitive', () => {
    expect(BONUS_CHALLENGES.length).toBeGreaterThan(DETERMINISTIC_CHALLENGE_COUNT);
    expect(BONUS_CHALLENGES.length).toBeGreaterThanOrEqual(20);
  });

  it('has unique ids', () => {
    const ids = BONUS_CHALLENGES.map((c) => c.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every challenge a machine-checkable rule or an explicit none', () => {
    for (const challenge of BONUS_CHALLENGES) {
      expect(challenge.rule, challenge.id).toBeDefined();
      expect(challenge.description.length, challenge.id).toBeLessThanOrEqual(85);
      expect(challenge.title.length, challenge.id).toBeLessThanOrEqual(25);
    }
  });

  it('never states a threshold a numeric check cannot use', () => {
    const numeric = BONUS_CHALLENGES.filter(
      (c) => c.rule?.checkKind === 'minLength' || c.rule?.checkKind === 'minVowels'
    );

    expect(numeric.length).toBeGreaterThan(0);
    for (const challenge of numeric) {
      expect(Number(challenge.rule!.checkValue), challenge.id).toBeGreaterThanOrEqual(1);
    }
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
