import { CategoryKey } from '../../src/types';
import {
  CategoryJudgement,
  Judge,
  JudgeVerdict,
  RoundEvaluation,
  RoundSubmission,
  ScoredCategory,
} from './types';

export const CATEGORY_KEYS: readonly CategoryKey[] = ['name', 'place', 'animal', 'thing'];

/**
 * The single source of truth for scoring. These numbers previously lived in
 * three places: the Gemini prompt, the local validator, and a second copy of
 * the speed ladder in the request handler.
 */
export const SCORING = {
  validAnswer: 10,
  validAnswerWithBonus: 15,
  invalidAnswer: 0,
  /** Evaluated in order; the first tier whose limit is met wins. */
  speedTiers: [
    { maxSeconds: 20, bonus: 20 },
    { maxSeconds: 35, bonus: 10 },
    { maxSeconds: 50, bonus: 5 },
  ],
  noSpeedBonus: 0,
  /** How many categories must match the bonus rule for the challenge to count as met. */
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

export function defaultOverallFeedback(validCount: number): string {
  if (validCount === 4) return 'Perfect score! All 4 categories matched brilliantly!';
  if (validCount >= 2) return 'Good effort! You filled out multiple categories.';
  return 'Keep practicing! Give it another shot!';
}

/**
 * Turns a verdict into a scored round. Pure — the entire scoring surface is
 * testable without a judge, a network, or a clock.
 */
export function scoreVerdict(verdict: JudgeVerdict, timeTakenSeconds: number): RoundEvaluation {
  const categories = {} as Record<CategoryKey, ScoredCategory>;
  let validCount = 0;
  let bonusMatches = 0;
  let baseScore = 0;

  for (const key of CATEGORY_KEYS) {
    const judgement = verdict.categories[key];
    const points = pointsFor(judgement);

    baseScore += points;
    if (judgement.valid) validCount++;
    if (judgement.bonusMatched) bonusMatches++;

    categories[key] = { ...judgement, points };
  }

  const speedBonus = speedBonusFor(timeTakenSeconds);

  return {
    categories,
    totalScore: baseScore + speedBonus,
    speedBonus,
    bonusChallengeMet:
      verdict.bonusChallengeMet ?? bonusMatches >= SCORING.bonusChallengeThreshold,
    overallFeedback: verdict.overallFeedback ?? defaultOverallFeedback(validCount),
    judgedBy: verdict.judgedBy,
  };
}

/** The referee's interface — the one call shape for evaluating a round. */
export async function evaluateRound(
  submission: RoundSubmission,
  judge: Judge
): Promise<RoundEvaluation> {
  const verdict = await judge.judge({
    letter: submission.letter,
    answers: submission.answers,
    bonusChallenge: submission.bonusChallenge,
  });

  return scoreVerdict(verdict, submission.timeTakenSeconds);
}

/**
 * Tries the primary judge and falls back on failure. Captures the try/catch that
 * previously appeared twice in the request handler.
 */
export function withFallback(primary: Judge, fallback: Judge): Judge {
  return {
    async judge(request) {
      try {
        return await primary.judge(request);
      } catch (err) {
        console.error('Primary judge failed, falling back to heuristic:', err);
        return fallback.judge(request);
      }
    },
  };
}
