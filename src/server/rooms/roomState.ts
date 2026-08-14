import type {
  BonusChallenge,
  RoomScoreRow,
  RoomStandingRow,
  RoomView,
  UserAnswers,
} from '../../shared/contract';
import { ROOM_ROUND_CHOICES } from '../../shared/contract';
import { ROOM_RULES, type Room, type RoomPlayerState } from './types';

/**
 * The room state machine.
 *
 * Pure and clock-injected: every function takes `now`, so the whole thing is
 * testable without timers, and the server can advance a room lazily when someone
 * reads it. That laziness is deliberate — the app scales to zero, so there is no
 * background process to reap rooms or fire a round's deadline. A room only ever
 * moves when someone is looking at it, which is exactly when it matters.
 *
 * Shape validated first as a throwaway prototype:
 * .scratch/multiplayer-rooms/prototype/room-state.html
 */

/** No O/0/I/1 — a code has to survive being read down a phone line. */
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
    judging: false,
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

/**
 * Drops players who have stopped polling, and closes a room nobody came back to.
 *
 * Called at the top of every read. A player who closes their laptop simply stops
 * polling — there is no disconnect event to listen for on a polling transport,
 * so absence is inferred from silence.
 */
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

/** The room must never be left with nobody able to start the next round. */
function ensureHost(room: Room): void {
  const present = presentPlayers(room);
  if (present.length === 0) return;
  if (present.some((p) => p.isHost)) return;

  const heir = [...present].sort((a, b) => a.joinedAt - b.joinedAt)[0];
  for (const p of room.players) p.isHost = p.id === heir.id;
}

export function join(room: Room, playerId: string, name: string, now: number): Room {
  const existing = findPlayer(room, playerId);

  if (existing) {
    // A refresh is indistinguishable from leaving, so the same client id
    // reclaims its seat rather than appearing as a second player.
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
    isHost: presentPlayers(room).length === 0,
    present: true,
    joinedAt: now,
    lastSeenAt: now,
  });
  room.emptySince = null;
  ensureHost(room);
  return room;
}

export function leave(room: Room, playerId: string, now: number): Room {
  const player = findPlayer(room, playerId);
  if (!player) return room;

  player.present = false;
  if (presentPlayers(room).length === 0) room.emptySince = now;
  else ensureHost(room);

  return room;
}

export function touch(room: Room, playerId: string, now: number): Room {
  const player = findPlayer(room, playerId);
  if (player) {
    player.present = true;
    player.lastSeenAt = now;
    room.emptySince = null;
  }
  return room;
}

/**
 * Whether the host may still choose the match length.
 *
 * Only before the first round: changing the finish line mid-match would move it
 * for players who have already raced, so the number is settled up front.
 */
export function canSetRounds(room: Room): boolean {
  return room.phase === 'lobby' && room.roundsPlayed === 0;
}

/** True once the final round of the match has been scored and shown. */
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
  // The number arrives from a browser, so it is checked against the same list the
  // client is offered rather than trusted.
  if (!(ROOM_ROUND_CHOICES as readonly number[]).includes(totalRounds)) {
    throw new RoomError('That is not a match length you can pick.', 400);
  }

  room.totalRounds = totalRounds;
  return room;
}

/** Clears the scoreboard and starts a fresh match, keeping everyone in their seats. */
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
  // Idempotent: a retry, a reconnect or a double-click must score once.
  if (room.round.submissions[playerId]) return room;

  // A submission that lands after the deadline is a timeout auto-submit arriving
  // inside the grace window. The answers still count — they were typed in time —
  // but the clock is capped at the round length so no late arrival wins the race.
  // Past the window it is refused: rooms only advance when someone reads them, so
  // without this a submission arriving minutes later would still be taken.
  const lateBy = now - room.round.deadline;
  if (lateBy > ROOM_RULES.submitGraceSeconds * 1000) {
    throw new RoomError('The round is over.', 409);
  }
  const elapsed = Math.max(1, Math.round((now - room.round.startedAt) / 1000));

  room.round.submissions[playerId] = {
    answers,
    timeTakenSeconds: lateBy >= 0 ? ROOM_RULES.roundSeconds : elapsed,
    auto: lateBy >= 0,
  };

  return maybeEndRound(room, now);
}

/** Ends the round once everyone still present has submitted. */
export function maybeEndRound(room: Room, now: number): Room {
  if (room.phase !== 'racing' || !room.round) return room;

  const outstanding = room.round.racers.filter((id) => {
    const player = findPlayer(room, id);
    return player?.present && !room.round!.submissions[id];
  });

  if (outstanding.length === 0) return endRound(room, 'all-submitted', now);
  // Held open past the deadline so the auto-submits fired by every client at zero
  // have time to arrive; without this the first poll after the deadline would
  // score them blank.
  if (now >= room.round.deadline + ROOM_RULES.submitGraceSeconds * 1000) {
    return endRound(room, 'clock', now);
  }
  return room;
}

function endRound(room: Room, endedBy: 'all-submitted' | 'clock', now: number): Room {
  if (!room.round) return room;

  // Anyone who never submitted is taken as they stand rather than dropped. Their
  // time is capped at the round length: the round ends when a poll notices the
  // deadline has passed, which can be well after the deadline itself.
  let anyAuto = false;
  for (const id of room.round.racers) {
    if (room.round.submissions[id]) continue;
    anyAuto = true;
    room.round.submissions[id] = {
      answers: { name: '', place: '', animal: '', thing: '' },
      timeTakenSeconds: Math.min(
        ROOM_RULES.roundSeconds,
        Math.max(1, Math.round((now - room.round.startedAt) / 1000))
      ),
      auto: true,
    };
  }

  // ⚠️ "Everyone finished" must mean everyone actually answered in time. A round
  // can also end because the last player still owing an answer went quiet, or
  // because every client auto-submitted on the buzzer — the room is no longer
  // waiting on anyone, but telling the survivors everyone finished is a lie.
  const anyLate = anyAuto || room.round.racers.some((id) => room.round!.submissions[id]?.auto);
  room.round.endedBy = anyLate ? 'clock' : endedBy;

  room.phase = 'judging';
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

/**
 * Ranks a scored round.
 *
 * ⚠️ Duplicate answers do NOT score less — each player is scored exactly as a
 * solo round is scored, so nothing here recomputes points. This is only a sort.
 * Ties break on time, because in a race whoever got there first is ahead; only
 * players level on BOTH share a rank, and then the next rank is skipped.
 */
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
  return sorted.map((row, index) => {
    const previous = sorted[index - 1];
    const level =
      previous !== undefined &&
      previous.totalScore === row.totalScore &&
      previous.timeTakenSeconds === row.timeTakenSeconds;

    lastRank = level ? lastRank : index + 1;
    return { ...row, rank: lastRank, tied: level };
  });
}

/** Records a finished round into the session standings. */
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

/** What one player is allowed to see. Never leaks another player's answers mid-round. */
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
