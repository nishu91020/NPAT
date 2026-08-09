/**
 * The wire contract between the client and the server.
 *
 * Everything here crosses the network, so both tiers must agree on it exactly.
 * Shapes that only ever live in the browser (saved games, UI copy) belong in
 * `client/types.ts`; shapes that only the server builds belong in
 * `server/referee/types.ts`.
 */

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
  /** An example of an answer that would have worked. Absent when none is needed. */
  suggestion?: string;
}

export interface ValidationResponse {
  categories: Record<CategoryKey, CategoryValidation>;
  totalScore: number;
  speedBonus: number;
  bonusChallengeMet: boolean;
  overallFeedback: string;
  judgedBy?: JudgedBy;
}
