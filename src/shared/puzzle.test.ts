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

const AVAILABLE_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T',
  'V', 'W',
];

function rawHashLetter(dateStr: string): string {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash << 5) - hash + dateStr.charCodeAt(i);
    hash |= 0;
  }
  return AVAILABLE_LETTERS[Math.abs(hash) % AVAILABLE_LETTERS.length];
}

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

  it('never gives the same letter two days running', () => {
    let previous = getDailyPuzzleData('2026-01-01').letter;

    for (let day = 1; day < 4000; day++) {
      const date = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString().split('T')[0];
      const letter = getDailyPuzzleData(date).letter;

      expect(letter, date).not.toBe(previous);
      previous = letter;
    }
  });

  it.each([
    { yesterday: '2030-12-31', today: '2031-01-01' },
    { yesterday: '2032-12-31', today: '2033-01-01' },
  ])('breaks the $today collision the raw hash used to produce', ({ yesterday, today }) => {
    expect(getDailyPuzzleData(today).letter).not.toBe(getDailyPuzzleData(yesterday).letter);
  });

  it('nudges only the days that collided, leaving every other date on its raw hash letter', () => {
    const nudged: string[] = [];

    for (let day = 0; day < 4000; day++) {
      const date = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString().split('T')[0];
      if (getDailyPuzzleData(date).letter !== rawHashLetter(date)) nudged.push(date);
    }

    expect(nudged).toEqual(['2031-01-01', '2033-01-01']);
  });

  it('survives a date string that is not a date, since /api/daily-challenge takes a query param', () => {
    expect(() => getDailyPuzzleData('not-a-date')).not.toThrow();
    expect(getDailyPuzzleData('not-a-date').letter).toBeTruthy();
  });

  it('still spreads the letters evenly', () => {
    const counts = new Map<string, number>();

    for (let day = 0; day < 2100; day++) {
      const date = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString().split('T')[0];
      const letter = getDailyPuzzleData(date).letter;
      counts.set(letter, (counts.get(letter) ?? 0) + 1);
    }

    expect(counts.size).toBe(21);
    for (const [letter, count] of counts) {
      expect(count, letter).toBeGreaterThan(60);
    }
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
