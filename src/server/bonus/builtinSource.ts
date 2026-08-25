import { BonusChallenge } from '../../shared/contract';
import { BONUS_CHALLENGES } from '../../shared/bonusChallenges';
import { getDailyPuzzleData } from '../../shared/puzzle';
import { BonusChallengeSource } from './dailyChallenge';

export const randomBuiltinSource: BonusChallengeSource = {
  async next(): Promise<BonusChallenge> {
    return BONUS_CHALLENGES[Math.floor(Math.random() * BONUS_CHALLENGES.length)];
  },
};

export function deterministicSourceForDate(dateStr: string): BonusChallengeSource {
  return {
    async next(): Promise<BonusChallenge> {
      return getDailyPuzzleData(dateStr).bonusChallenge;
    },
  };
}
