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
  /**
   * The secret that proves a caller is this player. Server-issued, never shown
   * to anybody else, and required by every request that acts on the room.
   *
   * ⚠️ The id cannot do this job: it is published to every player in the room, in
   * views and in results. Authorising on the id alone let any player submit for
   * another, act as the host, or mark a rival absent.
   */
  token: string;
  isHost: boolean;
  present: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

/** A caller's claim to a seat: who they say they are, and their proof of it. */
export interface PlayerSeat {
  playerId: string;
  token: string;
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
  /** How many rounds this match runs for. Host-set, and locked once round one starts. */
  totalRounds: number;
  createdAt: number;
  /** When the room became empty, or null while someone is here. */
  emptySince: number | null;
  /**
   * When a replica claimed the judging, or null when nobody holds it.
   *
   * A timestamp rather than a flag because the claim crosses processes: a replica
   * that is recycled mid-judgement would otherwise leave the room stuck in
   * `judging` for as long as it survives, with no one able to take over.
   */
  judgingSince: number | null;
  /**
   * Which round the current claim is judging, or null when nobody holds one.
   *
   * ⚠️ The phase alone does not identify a round. A replica whose model call hung
   * past `judgingClaimSeconds` loses the claim, another judges and publishes, and
   * the match moves on — and when the slow call finally returned it found the
   * room in `judging` again, for the NEXT round, and published the old round's
   * rows into it. That scored one round twice and threw the new one away.
   */
  judgingRound: number | null;
}

/**
 * A room as it was read, with the version it was read at.
 *
 * The version is what makes a shared store safe. Every mutation is a
 * read-modify-write, and with several replicas serving one room those interleave:
 * two players submitting at once on different processes would otherwise each save
 * a room built from a copy that predated the other, and one submission would
 * simply vanish. Writes are conditional on this value instead, and a caller that
 * loses the race is told so and redoes the change on fresh state.
 */
export interface StoredRoom {
  room: Room;
  /** Opaque to callers — only the adapter that issued it knows what it means. */
  version: string | null;
}

/** Thrown when a conditional write lost: something else wrote first. */
export class RoomVersionConflict extends Error {
  constructor(code: string) {
    super(`Room ${code} changed while it was being updated`);
    this.name = 'RoomVersionConflict';
  }
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
  /** Fails with `RoomVersionConflict` when that code is already taken. */
  create(room: Room): Promise<void>;
  get(code: string): Promise<StoredRoom | null>;
  /** Fails with `RoomVersionConflict` when the room moved on since it was read. */
  put(stored: StoredRoom): Promise<void>;
  delete(code: string): Promise<void>;
}

export interface RoomRules {
  roundSeconds: number;
  /**
   * How long after the deadline a submission is still taken.
   *
   * Every client auto-submits when its countdown hits zero, and that request has
   * to cross the network. Without a grace window the first poll to arrive after
   * the deadline would end the round and throw those answers away — the player
   * would be scored blank for a round they had actually filled in.
   */
  submitGraceSeconds: number;
  maxPlayers: number;
  /** How long an empty room survives — a refresh looks exactly like leaving. */
  emptyGraceSeconds: number;
  /** How long since a poll before a player is treated as gone. */
  presenceTimeoutSeconds: number;
  /** The match length used until the host picks one. */
  defaultRounds: number;
  /**
   * How long a judging claim is honoured before another replica may take it.
   *
   * Long enough to cover a slow model call, short enough that a replica dying
   * mid-judgement costs one wait rather than a room nobody can rescue.
   */
  judgingClaimSeconds: number;
}

export const ROOM_RULES: RoomRules = {
  roundSeconds: 60,
  submitGraceSeconds: 3,
  maxPlayers: 8,
  emptyGraceSeconds: 120,
  presenceTimeoutSeconds: 20,
  defaultRounds: 3,
  judgingClaimSeconds: 45,
};

export type ScoredRow = RoomScoreRow;
export type { RoomPhase, RoomResults };
