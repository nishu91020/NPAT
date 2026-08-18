import { CategoryKey, UserAnswers, ValidationResponse } from '../shared/contract';

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

  mode?: 'daily' | 'practice';
}

export interface GameStats {
  gamesPlayed: number;
  currentStreak: number;
  maxStreak: number;
  totalScore: number;
  wins: number;
  lastPlayedDate: string | null;
  history: Record<string, GameResult>;
}

export interface CategoryInfo {
  key: CategoryKey;
  label: string;
  placeholder: string;
  iconName: string;
  example: string;
}
