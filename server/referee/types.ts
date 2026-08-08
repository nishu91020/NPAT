import { BonusChallenge, CategoryKey, JudgedBy, UserAnswers } from '../../src/types';

export type { JudgedBy };

/**
 * What a judge is asked. Deliberately excludes the clock: judges rule on words,
 * never on speed, so a judge cannot influence the speed bonus.
 */
export interface JudgeRequest {
  letter: string;
  answers: UserAnswers;
  bonusChallenge: BonusChallenge;
}

/**
 * A judge's ruling on one category. Carries no points — the referee applies
 * scoring, so the points rules cannot vary between judges.
 */
export interface CategoryJudgement {
  valid: boolean;
  bonusMatched: boolean;
  feedback: string;
}

export interface JudgeVerdict {
  judgedBy: JudgedBy;
  categories: Record<CategoryKey, CategoryJudgement>;
  /** A judge may supply its own prose; the referee derives it otherwise. */
  overallFeedback?: string;
  bonusChallengeMet?: boolean;
}

/** The seam. Two adapters satisfy it: the AI judge in production, heuristic when degraded. */
export interface Judge {
  judge(request: JudgeRequest): Promise<JudgeVerdict>;
}

export interface RoundSubmission extends JudgeRequest {
  timeTakenSeconds: number;
}

export interface ScoredCategory extends CategoryJudgement {
  points: number;
}

export interface RoundEvaluation {
  categories: Record<CategoryKey, ScoredCategory>;
  totalScore: number;
  speedBonus: number;
  bonusChallengeMet: boolean;
  overallFeedback: string;
  judgedBy: JudgedBy;
}
