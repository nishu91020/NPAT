import type {
  BonusChallenge,
  RoomPhase,
  RoomResults,
  RoomScoreRow,
  UserAnswers,
} from '../../shared/contract';

export interface RoomSubmission {
  answers: UserAnswers;

  timeTakenSeconds: number;

  auto: boolean;
}

export interface RoomRoundState {
  number: number;
  letter: string;
  bonusChallenge: BonusChallenge;
  startedAt: number;
  deadline: number;

  racers: string[];
  submissions: Record<string, RoomSubmission>;
  endedBy: 'all-submitted' | 'clock' | null;
}

export interface RoomPlayerState {
  id: string;
  name: string;

  token: string;
  isHost: boolean;
  present: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

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

  totalRounds: number;
  createdAt: number;

  emptySince: number | null;

  judgingSince: number | null;

  judgingRound: number | null;
}

export interface StoredRoom {
  room: Room;

  version: string | null;
}

export class RoomVersionConflict extends Error {
  constructor(code: string) {
    super(`Room ${code} changed while it was being updated`);
    this.name = 'RoomVersionConflict';
  }
}

export interface RoomStore {

  create(room: Room): Promise<void>;
  get(code: string): Promise<StoredRoom | null>;

  put(stored: StoredRoom): Promise<void>;
  delete(code: string): Promise<void>;
}

export interface RoomRules {
  roundSeconds: number;

  submitGraceSeconds: number;
  maxPlayers: number;

  emptyGraceSeconds: number;

  presenceTimeoutSeconds: number;

  defaultRounds: number;

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
