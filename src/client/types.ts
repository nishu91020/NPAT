import { CategoryKey, UserAnswers, ValidationResponse } from '../shared/contract';

/**
 * Shapes that never leave the browser.
 *
 * The wire contract lives in `shared/contract.ts`. What is here is either
 * persisted in localStorage or is presentation copy, and the server has no
 * business knowing either.
 */

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
  /**
   * ⚠️ Legacy, and read-only. Every round is the daily one now, so nothing
   * writes this — but rounds saved while practice mode existed are still in
   * `localStorage` and arrive forever, carrying `'practice'` and a **random**
   * `dayNumber`. History reads it so those rounds are labelled honestly rather
   * than shown as a daily challenge they never were.
   */
  mode?: 'daily' | 'practice';
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

/** How one category is presented in the input form. */
export interface CategoryInfo {
  key: CategoryKey;
  label: string;
  placeholder: string;
  iconName: string;
  example: string;
}
