import { describe, expect, it } from 'vitest';
import { BONUS_CHALLENGES } from '../../shared/bonusChallenges';
import { getDailyPuzzleData } from '../../shared/puzzle';
import { deterministicSourceForDate, randomBuiltinSource } from './builtinSource';

describe('randomBuiltinSource', () => {
  it('always returns one of the built-in bonus challenges', async () => {
    const challenge = await randomBuiltinSource.next('S');

    expect(BONUS_CHALLENGES).toContainEqual(challenge);
  });
});

describe('deterministicSourceForDate', () => {
  it('returns the daily challenge for that date', async () => {
    const date = '2026-08-08';

    const source = deterministicSourceForDate(date);
    const expected = getDailyPuzzleData(date).bonusChallenge;

    await expect(source.next('S')).resolves.toEqual(expected);
  });
});
