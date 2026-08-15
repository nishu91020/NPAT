import { BonusChallenge } from '../../shared/contract';
import { BONUS_CHALLENGES, getDailyPuzzleData } from '../../shared/puzzle';
import { BonusChallengeSource } from './types';

/** Picks a random built-in challenge. The fallback for room rounds. */
export const randomBuiltinSource: BonusChallengeSource = {
  async next(): Promise<BonusChallenge> {
    return BONUS_CHALLENGES[Math.floor(Math.random() * BONUS_CHALLENGES.length)];
  },
};

/**
 * The deterministic challenge for a date, derived from the same date hash that
 * picks the letter. Guarantees every player sees the same bonus on a given day.
 */
export function deterministicSourceForDate(dateStr: string): BonusChallengeSource {
  return {
    async next(): Promise<BonusChallenge> {
      return getDailyPuzzleData(dateStr).bonusChallenge;
    },
  };
}
