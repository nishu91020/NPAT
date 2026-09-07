import { BonusScope, CategoryKey } from '../../shared/contract';
import { CategoryJudgement } from './types';

export const CATEGORY_KEYS: readonly CategoryKey[] = ['name', 'place', 'animal', 'thing'];

export const SCORING = {
  validAnswer: 10,
  validAnswerWithBonus: 15,
  invalidAnswer: 0,

  speedTiers: [
    { maxSeconds: 20, bonus: 20 },
    { maxSeconds: 35, bonus: 10 },
    { maxSeconds: 50, bonus: 5 },
  ],
  noSpeedBonus: 0,

  bonusChallengeThreshold: 2,
} as const;

export function speedBonusFor(timeTakenSeconds: number): number {
  const tier = SCORING.speedTiers.find((t) => timeTakenSeconds <= t.maxSeconds);
  return tier ? tier.bonus : SCORING.noSpeedBonus;
}

export function pointsFor(judgement: CategoryJudgement): number {
  if (!judgement.valid) return SCORING.invalidAnswer;
  return judgement.bonusMatched ? SCORING.validAnswerWithBonus : SCORING.validAnswer;
}

export function bonusMetFor(scope: BonusScope, matched: readonly CategoryKey[]): boolean {
  if (scope === 'all') return matched.length === CATEGORY_KEYS.length;
  if (scope === 'some') return matched.length >= SCORING.bonusChallengeThreshold;
  return matched.includes(scope);
}
