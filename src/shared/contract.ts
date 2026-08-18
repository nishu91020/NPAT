export type CategoryKey = 'name' | 'place' | 'animal' | 'thing';

export type JudgedBy = 'azure' | 'gemini' | 'heuristic';

export interface BonusChallenge {
  id: string;
  title: string;
  description: string;
  icon: string;
  ruleHint: string;

  rule?: BonusRule;
}

export type BonusScope = 'all' | 'some' | CategoryKey;

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

  checkValue: string;
}

export interface DailyPuzzle {
  dayNumber: number;
  dateString: string;
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

export type RoomPhase = 'lobby' | 'racing' | 'judging' | 'reveal';

export interface RoomPlayer {
  id: string;
  name: string;
  isHost: boolean;
  present: boolean;

  racing: boolean;
  hasSubmitted: boolean;
}

export interface RoomRound {
  number: number;
  letter: string;
  bonusChallenge: BonusChallenge;
  endsAt: string;
  serverNow: string;
}

export interface RoomScoreRow {
  playerId: string;
  name: string;

  rank: number;
  tied: boolean;
  totalScore: number;
  speedBonus: number;
  timeTakenSeconds: number;

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

export const ROOM_ROUND_CHOICES = [1, 3, 5, 10] as const;

export interface RoomView {
  code: string;
  phase: RoomPhase;
  players: RoomPlayer[];
  round: RoomRound | null;
  results: RoomResults | null;
  standings: RoomStandingRow[];
  roundsPlayed: number;

  totalRounds: number;

  canSetRounds: boolean;

  matchComplete: boolean;

  youId: string;
  youAreHost: boolean;

  youToken?: string;
}
