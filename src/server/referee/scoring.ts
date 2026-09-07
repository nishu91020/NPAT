import { BonusChallenge, CategoryKey } from '../../shared/contract';
import { enforceBonusRule, enforceSuggestions } from './roundGuardrails';
import { NO_RULING, applyBonusRuling, type BonusRuling } from './roundBonus';
import { CATEGORY_KEYS, SCORING, bonusMetFor, pointsFor, speedBonusFor } from './rules';
import {
  Judge,
  JudgeVerdict,
  RoundEvaluation,
  RoundSubmission,
  ScoredCategory,
} from './types';

export function defaultOverallFeedback(validCount: number): string {
  if (validCount === 4) return 'Perfect score! All 4 categories matched brilliantly!';
  if (validCount >= 2) return 'Good effort! You filled out multiple categories.';
  return 'Keep practicing! Give it another shot!';
}

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

  const speedBonus =
    validCount === CATEGORY_KEYS.length
      ? speedBonusFor(timeTakenSeconds)
      : SCORING.noSpeedBonus;
  const meetsScope = bonusMetFor(challenge?.rule?.scope ?? 'some', matchedKeys);

  return {
    categories,
    totalScore: baseScore + speedBonus,
    speedBonus,

    bonusChallengeMet:
      verdict.bonusChallengeMet === undefined
        ? meetsScope
        : verdict.bonusChallengeMet && meetsScope,
    overallFeedback: verdict.overallFeedback ?? defaultOverallFeedback(validCount),
    judgedBy: verdict.judgedBy,
  };
}

export async function evaluateRound(
  submission: RoundSubmission,
  judge: Judge,
  ruling: BonusRuling = NO_RULING
): Promise<RoundEvaluation> {
  const verdict = await judge.judge({
    letter: submission.letter,
    answers: submission.answers,
    bonusChallenge: submission.bonusChallenge,
  });

  const shared = applyBonusRuling(
    verdict,
    submission.answers,
    submission.bonusChallenge,
    ruling
  );

  const settled = enforceBonusRule(shared, submission.answers, submission.bonusChallenge);

  const advised = enforceSuggestions(
    settled,
    submission.letter,
    submission.bonusChallenge,
    submission.answers
  );

  return scoreVerdict(advised, submission.timeTakenSeconds, submission.bonusChallenge);
}

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
