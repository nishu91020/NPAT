import type {
  BonusChallenge,
  RoomResults,
  RoomScoreRow,
  RoomStandingRow,
  RoomView,
  UserAnswers,
} from '../../shared/contract';
import { ROOM_ROUND_CHOICES } from '../../shared/contract';
import { ROOM_RULES, type PlayerSeat, type Room, type RoomPlayerState } from './types';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

export function generateRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function createRoom(code: string, now: number): Room {
  return {
    code,
    phase: 'lobby',
    players: [],
    round: null,
    results: null,
    standings: {},
    roundsPlayed: 0,
    totalRounds: ROOM_RULES.defaultRounds,
    createdAt: now,
    emptySince: now,
    judgingSince: null,
    judgingRound: null,
  };
}

export function findPlayer(room: Room, playerId: string): RoomPlayerState | undefined {
  return room.players.find((p) => p.id === playerId);
}

function presentPlayers(room: Room): RoomPlayerState[] {
  return room.players.filter((p) => p.present);
}

export class RoomError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'RoomError';
  }
}

export function reapAbsent(room: Room, now: number): Room {
  for (const player of room.players) {
    if (!player.present) continue;
    const silentFor = (now - player.lastSeenAt) / 1000;
    if (silentFor > ROOM_RULES.presenceTimeoutSeconds) {
      player.present = false;
    }
  }

  if (presentPlayers(room).length === 0) {
    room.emptySince = room.emptySince ?? now;
  } else {
    room.emptySince = null;
    ensureHost(room);
  }

  return room;
}

export function isExpired(room: Room, now: number): boolean {
  return (
    room.emptySince !== null && (now - room.emptySince) / 1000 >= ROOM_RULES.emptyGraceSeconds
  );
}

function ensureHost(room: Room): void {
  const present = presentPlayers(room);
  if (present.length === 0) return;
  if (present.some((p) => p.isHost)) return;

  const heir = [...present].sort((a, b) => a.joinedAt - b.joinedAt)[0];
  for (const p of room.players) p.isHost = p.id === heir.id;
}

export function join(
  room: Room,
  playerId: string,
  name: string,
  now: number,
  token: string
): Room {
  const existing = findPlayer(room, playerId);

  if (existing) {

    if (existing.token !== token) throw new RoomError('That seat is taken.', 403);

    existing.present = true;
    existing.lastSeenAt = now;
    existing.name = name || existing.name;
    room.emptySince = null;
    ensureHost(room);
    return room;
  }

  if (presentPlayers(room).length >= ROOM_RULES.maxPlayers) {
    throw new RoomError('This room is full.', 409);
  }

  room.players.push({
    id: playerId,
    name,
    token,
    isHost: presentPlayers(room).length === 0,
    present: true,
    joinedAt: now,
    lastSeenAt: now,
  });
  room.emptySince = null;
  ensureHost(room);
  return room;
}

export function authorize(room: Room, seat: PlayerSeat): RoomPlayerState {
  const player = findPlayer(room, seat.playerId);
  if (!player || !seat.token || player.token !== seat.token) {
    throw new RoomError('You are not in this room.', 403);
  }
  return player;
}

export function leave(room: Room, playerId: string, now: number): Room {
  const player = findPlayer(room, playerId);
  if (!player) return room;

  player.present = false;
  if (presentPlayers(room).length === 0) room.emptySince = now;
  else ensureHost(room);

  return room;
}

const PRESENCE_WRITE_INTERVAL_SECONDS = 5;

export function touch(room: Room, playerId: string, now: number): boolean {
  const player = findPlayer(room, playerId);
  if (!player) return false;

  const wasPresent = player.present;
  const stale = (now - player.lastSeenAt) / 1000 >= PRESENCE_WRITE_INTERVAL_SECONDS;
  const wasEmpty = room.emptySince !== null;

  player.present = true;
  player.lastSeenAt = now;
  room.emptySince = null;

  return !wasPresent || stale || wasEmpty;
}

export function canSetRounds(room: Room): boolean {
  return room.phase === 'lobby' && room.roundsPlayed === 0;
}

export function isMatchComplete(room: Room): boolean {
  if (room.phase === 'racing' || room.phase === 'judging') return false;
  return room.roundsPlayed >= room.totalRounds;
}

export function setTotalRounds(room: Room, playerId: string, totalRounds: number): Room {
  const player = findPlayer(room, playerId);
  if (!player || !player.isHost) throw new RoomError('Only the host can set the rounds.', 403);
  if (!canSetRounds(room)) {
    throw new RoomError('The match has already started.', 409);
  }

  if (!(ROOM_ROUND_CHOICES as readonly number[]).includes(totalRounds)) {
    throw new RoomError('That is not a match length you can pick.', 400);
  }

  room.totalRounds = totalRounds;
  return room;
}

export function newMatch(room: Room, playerId: string): Room {
  const player = findPlayer(room, playerId);
  if (!player || !player.isHost) throw new RoomError('Only the host can start a match.', 403);
  if (room.phase === 'racing' || room.phase === 'judging') {
    throw new RoomError('A round is still running.', 409);
  }

  room.phase = 'lobby';
  room.round = null;
  room.results = null;
  room.standings = {};
  room.roundsPlayed = 0;
  room.judgingSince = null;
  room.judgingRound = null;
  return room;
}

export function startRound(
  room: Room,
  playerId: string,
  letter: string,
  bonusChallenge: BonusChallenge,
  now: number
): Room {
  const player = findPlayer(room, playerId);
  if (!player || !player.isHost) throw new RoomError('Only the host can start a round.', 403);
  if (room.phase !== 'lobby') throw new RoomError('A round is already running.', 409);
  if (room.roundsPlayed >= room.totalRounds) {
    throw new RoomError('This match is over. Start a new match to keep playing.', 409);
  }

  const racers = presentPlayers(room).map((p) => p.id);
  if (racers.length === 0) throw new RoomError('Nobody is in the room.', 409);

  room.roundsPlayed += 1;
  room.phase = 'racing';
  room.results = null;
  room.round = {
    number: room.roundsPlayed,
    letter,
    bonusChallenge,
    startedAt: now,
    deadline: now + ROOM_RULES.roundSeconds * 1000,
    racers,
    submissions: {},
    endedBy: null,
  };
  return room;
}

export function submit(
  room: Room,
  playerId: string,
  answers: UserAnswers,
  now: number
): Room {
  if (room.phase !== 'racing' || !room.round) throw new RoomError('No round is running.', 409);
  if (!room.round.racers.includes(playerId)) {
    throw new RoomError('You are not in this round.', 403);
  }

  if (room.round.submissions[playerId]) return room;

  const lateBy = now - room.round.deadline;
  if (lateBy > ROOM_RULES.submitGraceSeconds * 1000) {
    throw new RoomError('The round is over.', 409);
  }
  const elapsed = Math.max(1, Math.ceil((now - room.round.startedAt) / 1000));

  room.round.submissions[playerId] = {
    answers,
    timeTakenSeconds: lateBy >= 0 ? ROOM_RULES.roundSeconds : elapsed,
    auto: lateBy >= 0,
  };

  return maybeEndRound(room, now);
}

export function maybeEndRound(room: Room, now: number): Room {
  if (room.phase !== 'racing' || !room.round) return room;

  const outstanding = room.round.racers.filter((id) => {
    const player = findPlayer(room, id);
    return player?.present && !room.round!.submissions[id];
  });

  if (outstanding.length === 0) return endRound(room, 'all-submitted', now);

  if (now >= room.round.deadline + ROOM_RULES.submitGraceSeconds * 1000) {
    return endRound(room, 'clock', now);
  }
  return room;
}

function endRound(room: Room, endedBy: 'all-submitted' | 'clock', now: number): Room {
  if (!room.round) return room;

  let anyAuto = false;
  for (const id of room.round.racers) {
    if (room.round.submissions[id]) continue;
    anyAuto = true;
    room.round.submissions[id] = {
      answers: { name: '', place: '', animal: '', thing: '' },
      timeTakenSeconds: Math.min(
        ROOM_RULES.roundSeconds,
        Math.max(1, Math.ceil((now - room.round.startedAt) / 1000))
      ),
      auto: true,
    };
  }

  const anyLate = anyAuto || room.round.racers.some((id) => room.round!.submissions[id]?.auto);
  room.round.endedBy = anyLate ? 'clock' : endedBy;

  room.phase = 'judging';
  return room;
}

export function canClaimJudging(room: Room, now: number): boolean {
  if (room.phase !== 'judging') return false;
  if (room.judgingSince === null) return true;
  return (now - room.judgingSince) / 1000 >= ROOM_RULES.judgingClaimSeconds;
}

export function claimJudging(room: Room, now: number): Room {
  room.judgingSince = now;
  room.judgingRound = room.round?.number ?? null;
  return room;
}

export function claimStillHolds(room: Room, roundNumber: number): boolean {
  return room.phase === 'judging' && room.round?.number === roundNumber;
}

export function publishResults(room: Room, results: RoomResults): Room {
  room.results = results;
  recordResults(room, results.rows);
  room.phase = 'reveal';
  room.judgingSince = null;
  room.judgingRound = null;
  return room;
}

export function backToLobby(room: Room, playerId: string): Room {
  const player = findPlayer(room, playerId);
  if (!player || !player.isHost) throw new RoomError('Only the host can start a round.', 403);
  if (room.phase !== 'reveal') throw new RoomError('The round is not finished.', 409);
  if (isMatchComplete(room)) {
    throw new RoomError('This match is over. Start a new match to keep playing.', 409);
  }

  room.phase = 'lobby';
  room.round = null;
  return room;
}

export function rankRows<T extends { totalScore: number; timeTakenSeconds: number; name: string }>(
  rows: T[]
): (T & { rank: number; tied: boolean })[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.totalScore - a.totalScore ||
      a.timeTakenSeconds - b.timeTakenSeconds ||
      a.name.localeCompare(b.name)
  );

  let lastRank = 0;
  const ranked = sorted.map((row, index) => {
    const previous = sorted[index - 1];
    const level =
      previous !== undefined &&
      previous.totalScore === row.totalScore &&
      previous.timeTakenSeconds === row.timeTakenSeconds;

    lastRank = level ? lastRank : index + 1;
    return { ...row, rank: lastRank, tied: false };
  });

  const shared = new Map<number, number>();
  for (const row of ranked) shared.set(row.rank, (shared.get(row.rank) ?? 0) + 1);
  for (const row of ranked) row.tied = (shared.get(row.rank) ?? 0) > 1;

  return ranked;
}

export function recordResults(room: Room, rows: RoomScoreRow[]): Room {
  for (const row of rows) {
    const entry = (room.standings[row.playerId] ??= {
      playerId: row.playerId,
      name: row.name,
      totalScore: 0,
      timeTakenSeconds: 0,
      roundsPlayed: 0,
      wins: 0,
    });
    entry.name = row.name;
    entry.totalScore += row.totalScore;
    entry.timeTakenSeconds += row.timeTakenSeconds;
    entry.roundsPlayed += 1;
    if (row.rank === 1) entry.wins += 1;
  }
  return room;
}

export function standingsOf(room: Room): RoomStandingRow[] {
  return rankRows(Object.values(room.standings)).map((row) => ({
    playerId: row.playerId,
    name: row.name,
    rank: row.rank,
    tied: row.tied,
    totalScore: row.totalScore,
    roundsPlayed: row.roundsPlayed,
    wins: row.wins,
  }));
}

export function toView(room: Room, playerId: string, now: number): RoomView {
  const you = findPlayer(room, playerId);

  return {
    code: room.code,
    phase: room.phase,
    players: room.players
      .filter((p) => p.present)
      .map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        present: p.present,
        racing: room.round?.racers.includes(p.id) ?? false,
        hasSubmitted: Boolean(room.round?.submissions[p.id]),
      })),
    round: room.round
      ? {
          number: room.round.number,
          letter: room.round.letter,
          bonusChallenge: room.round.bonusChallenge,
          endsAt: new Date(room.round.deadline).toISOString(),
          serverNow: new Date(now).toISOString(),
        }
      : null,
    results: room.phase === 'reveal' ? room.results : null,
    standings: standingsOf(room),
    roundsPlayed: room.roundsPlayed,
    totalRounds: room.totalRounds,
    canSetRounds: canSetRounds(room),
    matchComplete: isMatchComplete(room),
    youId: playerId,
    youAreHost: Boolean(you?.isHost),
  };
}
