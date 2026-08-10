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
  /**
   * The rule stated in a form the game can settle itself.
   *
   * Optional because challenges generated before this existed are still in the
   * store and must keep working; absent means "ask the judge and count".
   */
  rule?: BonusRule;
}

/**
 * How many answers a bonus rule applies to.
 *
 * `some` is the historical default. A single category is spelled out because a
 * rule like "the Thing must be edible" can never be satisfied by two answers,
 * so counting matches against a threshold of two made it impossible to win.
 */
export type BonusScope = 'all' | 'some' | CategoryKey;

/**
 * Rules the game settles in code rather than asking a model.
 *
 * `none` means the rule needs world knowledge — whether a place is a capital,
 * whether a name is famous — and only a judge can rule on it. Everything else
 * is a property of the letters, which a model answers inconsistently: the same
 * word was scored differently on repeated runs of an identical request.
 */
export type BonusCheckKind =
  | 'none'
  | 'minLength'
  | 'minVowels'
  | 'adjacentVowels'
  | 'doubleLetter'
  | 'endsWith'
  | 'endsWithVowel';

export interface BonusRule {
  scope: BonusScope;
  checkKind: BonusCheckKind;
  /** The parameter for the check. Empty when the kind takes none. */
  checkValue: string;
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
