import type {
  BonusChallenge,
  RoomPhase,
  RoomResults,
  RoomScoreRow,
  UserAnswers,
} from '../../shared/contract';

/** A player's submission for the round in progress. */
export interface RoomSubmission {
  answers: UserAnswers;
  /**
   * Measured by the SERVER from its own round start.
   *
   * The solo game trusts the browser's `timeTakenSeconds`, which is harmless when
   * you only compete against yourself. Here it decides who beat whom, so the
   * client never gets to report it.
   */
  timeTakenSeconds: number;
  /** True when the clock ran out before they submitted anything. */
  auto: boolean;
}

export interface RoomRoundState {
  number: number;
  letter: string;
  bonusChallenge: BonusChallenge;
  startedAt: number;
  deadline: number;
  /** Everyone present when the host started. Late joiners are excluded. */
  racers: string[];
  submissions: Record<string, RoomSubmission>;
  endedBy: 'all-submitted' | 'clock' | null;
}

export interface RoomPlayerState {
  id: string;
  name: string;
  isHost: boolean;
  present: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

export interface RoomStandingState {
  playerId: string;
  name: string;
  totalScore: number;
  timeTakenSeconds: number;
  roundsPlayed: number;
  wins: number;
}

export interface Room {
  code: string;
  phase: RoomPhase;
  players: RoomPlayerState[];
  round: RoomRoundState | null;
  results: RoomResults | null;
  standings: Record<string, RoomStandingState>;
  roundsPlayed: number;
  createdAt: number;
  /** When the room became empty, or null while someone is here. */
  emptySince: number | null;
  /** Set while judging is in flight, so a poll cannot start it twice. */
  judging: boolean;
}

/**
 * The one place a room can be read from or written to.
 *
 * Deliberately shaped like `DailyChallengeStore`: a port with adapters, so the
 * in-memory implementation can be swapped for a shared one without touching a
 * single caller. That matters because this app runs at up to 5 replicas — two
 * players in one room can be served by different processes — which is the exact
 * bug the daily challenge already had once.
 */
export interface RoomStore {
  create(room: Room): Promise<void>;
  get(code: string): Promise<Room | null>;
  put(room: Room): Promise<void>;
  delete(code: string): Promise<void>;
}

export interface RoomRules {
  roundSeconds: number;
  maxPlayers: number;
  /** How long an empty room survives — a refresh looks exactly like leaving. */
  emptyGraceSeconds: number;
  /** How long since a poll before a player is treated as gone. */
  presenceTimeoutSeconds: number;
}

export const ROOM_RULES: RoomRules = {
  roundSeconds: 60,
  maxPlayers: 8,
  emptyGraceSeconds: 120,
  presenceTimeoutSeconds: 20,
};

export type ScoredRow = RoomScoreRow;
export type { RoomPhase, RoomResults };
