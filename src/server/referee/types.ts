import { BonusChallenge, CategoryKey, JudgedBy, UserAnswers } from '../../shared/contract';

export type { JudgedBy };

export interface JudgeRequest {
  letter: string;
  answers: UserAnswers;
  bonusChallenge: BonusChallenge;
}

export interface CategoryJudgement {
  valid: boolean;
  bonusMatched: boolean;
  feedback: string;

  suggestion?: string;
}

export interface JudgeVerdict {
  judgedBy: JudgedBy;
  categories: Record<CategoryKey, CategoryJudgement>;

  overallFeedback?: string;
  bonusChallengeMet?: boolean;
}

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
