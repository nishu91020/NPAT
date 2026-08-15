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

/* ---------------------------------------------------------------------------
 * Rooms — playing the same letter against other people.
 *
 * A room is the first thing in this app with state that outlives a request and
 * is shared between players. The round is a live synchronised race: the host
 * starts it, everyone runs one clock the SERVER owns, and answers are revealed
 * together. See .scratch/multiplayer-rooms/ for how each rule was decided.
 * ------------------------------------------------------------------------- */

export type RoomPhase = 'lobby' | 'racing' | 'judging' | 'reveal';

export interface RoomPlayer {
  id: string;
  name: string;
  isHost: boolean;
  present: boolean;
  /** Whether they are in the round currently running. Late joiners are not. */
  racing: boolean;
  hasSubmitted: boolean;
}

/**
 * The round in progress.
 *
 * `endsAt` and `serverNow` are both sent so the client can render a countdown
 * from the *difference* rather than trusting its own clock, which may be wrong
 * by minutes. The server alone decides when the round is actually over.
 */
export interface RoomRound {
  number: number;
  letter: string;
  bonusChallenge: BonusChallenge;
  endsAt: string;
  serverNow: string;
}

/** One player's scored round. Identical to a solo round — see RoomScoreRow. */
export interface RoomScoreRow {
  playerId: string;
  name: string;
  /** Standard competition ranking: players level on score AND time share a rank. */
  rank: number;
  tied: boolean;
  totalScore: number;
  speedBonus: number;
  timeTakenSeconds: number;
  /** True when the clock ran out before they submitted. */
  auto: boolean;
  answers: UserAnswers;
  categories: Record<CategoryKey, CategoryValidation>;
  judgedBy?: JudgedBy;
}

export interface RoomStandingRow {
  playerId: string;
  name: string;
  rank: number;
  tied: boolean;
  totalScore: number;
  roundsPlayed: number;
  wins: number;
}

export interface RoomResults {
  rows: RoomScoreRow[];
  endedBy: 'all-submitted' | 'clock';
}

/**
 * The match lengths a host is offered.
 *
 * On the wire because both tiers need it: the client renders the choice and the
 * server refuses anything outside it, rather than trusting a number from a browser.
 */
export const ROOM_ROUND_CHOICES = [1, 3, 5, 10] as const;

/** Everything one player needs to render the room. The only room shape on the wire. */
export interface RoomView {
  code: string;
  phase: RoomPhase;
  players: RoomPlayer[];
  round: RoomRound | null;
  results: RoomResults | null;
  standings: RoomStandingRow[];
  roundsPlayed: number;
  /** How long this match runs for. The host sets it before the first round. */
  totalRounds: number;
  /** True while the host can still change `totalRounds` — before round one. */
  canSetRounds: boolean;
  /** True once the final round of the match has been revealed. */
  matchComplete: boolean;
  /** Who the caller is, so the client never has to guess which player is theirs. */
  youId: string;
  youAreHost: boolean;
  /**
   * The secret that proves this caller owns their seat. Sent only in the reply to
   * creating or joining, and only to that caller.
   *
   * ⚠️ A room's player ids are public — every player sees every other player's id
   * in `players`, and results carry them too. So the id names a seat, it does not
   * prove ownership of one: without this token, anyone who read a view could
   * submit answers as another player, start a round as the host, or mark someone
   * absent. Every request that acts on a room carries it.
   */
  youToken?: string;
}
