import { BonusChallenge } from '../../src/types';
import { BONUS_CHALLENGES, getDailyPuzzleData } from '../../src/utils/puzzleData';
import { BonusChallengeSource } from './types';

/** Picks a random built-in challenge. Used for practice rounds. */
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
