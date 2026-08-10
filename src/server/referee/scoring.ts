import { BonusChallenge, BonusScope, CategoryKey } from '../../shared/contract';
import { enforceBonusRule } from './bonusRule';
import { enforceSuggestions } from './suggestion';
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
 * three places: the AI prompt, the local validator, and a second copy of
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
 * Whether the challenge as a whole is met, given which categories matched.
 *
 * The scope matters because counting every rule against a fixed threshold of two
 * made single-category challenges impossible: "the Thing must be edible" can
 * only ever be matched by one answer, so four of the seven built-in challenges
 * could never be completed however well they were answered.
 */
export function bonusMetFor(scope: BonusScope, matched: readonly CategoryKey[]): boolean {
  if (scope === 'all') return matched.length === CATEGORY_KEYS.length;
  if (scope === 'some') return matched.length >= SCORING.bonusChallengeThreshold;
  return matched.includes(scope);
}

/**
 * Turns a verdict into a scored round. Pure — the entire scoring surface is
 * testable without a judge, a network, or a clock.
 */
export function scoreVerdict(
  verdict: JudgeVerdict,
  timeTakenSeconds: number,
  challenge?: BonusChallenge
): RoundEvaluation {
  const categories = {} as Record<CategoryKey, ScoredCategory>;
  let validCount = 0;
  let baseScore = 0;
  const matchedKeys: CategoryKey[] = [];

  for (const key of CATEGORY_KEYS) {
    const judgement = verdict.categories[key];
    const points = pointsFor(judgement);

    baseScore += points;
    if (judgement.valid) validCount++;
    if (judgement.bonusMatched) matchedKeys.push(key);

    categories[key] = { ...judgement, points };
  }

  // The speed bonus rewards a round answered well and quickly, not merely
  // submitted quickly: four blanks sent instantly used to score 20. Matching the
  // bonus challenge is not required — a right answer that misses the bonus is
  // still a right answer.
  const speedBonus =
    validCount === CATEGORY_KEYS.length
      ? speedBonusFor(timeTakenSeconds)
      : SCORING.noSpeedBonus;
  const meetsScope = bonusMetFor(challenge?.rule?.scope ?? 'some', matchedKeys);

  return {
    categories,
    totalScore: baseScore + speedBonus,
    speedBonus,
    // A judge may hold a stricter view than the rule — a rule reading "all
    // four answers" is not met by two. But it may never claim the challenge was
    // met while its own per-category rulings say otherwise, so both must agree.
    bonusChallengeMet:
      verdict.bonusChallengeMet === undefined
        ? meetsScope
        : verdict.bonusChallengeMet && meetsScope,
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

  // Applied here rather than inside a judge, so every judge — including the
  // fallback — is held to the same rule.
  const settled = enforceBonusRule(verdict, submission.answers, submission.bonusChallenge);

  // Suggestions are settled after the bonus, because whether one stands depends
  // on the rule the round was actually played under.
  const advised = enforceSuggestions(
    settled,
    submission.letter,
    submission.bonusChallenge,
    submission.answers
  );

  return scoreVerdict(advised, submission.timeTakenSeconds, submission.bonusChallenge);
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
