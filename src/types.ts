export type CategoryKey = 'name' | 'place' | 'animal' | 'thing';

/** Which referee ruled on a round. Absent on rounds stored before this existed. */
export type JudgedBy = 'azure' | 'gemini' | 'heuristic';

export interface BonusChallenge {
  id: string;
  title: string;
  description: string;
  icon: string;
  ruleHint: string;
}

export interface DailyPuzzle {
  dayNumber: number;
  dateString: string; // YYYY-MM-DD
  letter: string;
  bonusChallenge: BonusChallenge;
  timeLimitSeconds: number;
}

export interface UserAnswers {
  name: string;
  place: string;
  animal: string;
  thing: string;
}

export interface CategoryValidation {
  valid: boolean;
  points: number;
  bonusMatched: boolean;
  feedback: string;
}

export interface ValidationResponse {
  categories: Record<CategoryKey, CategoryValidation>;
  totalScore: number;
  speedBonus: number;
  bonusChallengeMet: boolean;
  overallFeedback: string;
  judgedBy?: JudgedBy;
}

export interface GameResult {
  dayNumber: number;
  dateString: string;
  letter: string;
  answers: UserAnswers;
  validation: ValidationResponse;
  score: number;
  streak: number;
  timeTaken: number;
  livesRemaining: number;
  completedAt: string;
  mode: 'daily' | 'practice';
}

export interface GameStats {
  gamesPlayed: number;
  currentStreak: number;
  maxStreak: number;
  totalScore: number;
  wins: number;
  lastPlayedDate: string | null;
  history: Record<string, GameResult>; // key by YYYY-MM-DD or unique key
}

export interface CategoryInfo {
  key: CategoryKey;
  label: string;
  placeholder: string;
  iconName: string;
  example: string;
}
