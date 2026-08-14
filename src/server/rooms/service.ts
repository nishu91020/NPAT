import type {
  BonusChallenge,
  RoomScoreRow,
  RoomView,
  UserAnswers,
} from '../../shared/contract';
import { evaluateRound, type Judge } from '../referee';
import { createMemoryRoomStore } from './memoryStore';
import {
  RoomError,
  backToLobby,
  createRoom,
  findPlayer,
  generateRoomCode,
  isExpired,
  join,
  maybeEndRound,
  newMatch,
  rankRows,
  reapAbsent,
  recordResults,
  setTotalRounds,
  startRound,
  submit,
  toView,
  touch,
} from './roomState';
import type { Room, RoomStore } from './types';

export interface RoomServiceDeps {
  store?: RoomStore;
  judge: Judge;
  /** Supplies the letter and bonus challenge for each round. */
  nextPuzzle: (excludeLetter?: string) => Promise<{ letter: string; bonusChallenge: BonusChallenge }>;
  now?: () => number;
}

/**
 * The room service — everything the HTTP layer needs, and nothing about HTTP.
 *
 * Rooms advance **lazily, when read**. There is no timer and no sweeper, because
 * the app scales to zero and a background job would keep a replica alive purely
 * to watch a clock. Every entry point loads the room, advances it to `now`, acts,
 * and saves.
 */
export function createRoomService({
  store = createMemoryRoomStore(),
  judge,
  nextPuzzle,
  now = () => Date.now(),
}: RoomServiceDeps) {
  /** Loads a room and brings it up to date, or throws if it is gone. */
  async function load(code: string): Promise<Room> {
    const room = await store.get(code.toUpperCase());
    if (!room) throw new RoomError('That room does not exist.', 404);

    const at = now();
    reapAbsent(room, at);

    if (isExpired(room, at)) {
      await store.delete(room.code);
      throw new RoomError('That room has closed.', 404);
    }

    return room;
  }

  /**
   * Judges every racer, in parallel, each exactly as a solo round is judged.
   *
   * Independent calls are only safe because duplicate answers do not score less:
   * no player's score depends on another's. It also keeps one player's content
   * filter rejection from taking down everyone else's round.
   */
  async function judgeRound(room: Room): Promise<void> {
    if (!room.round || room.judging) return;
    room.judging = true;

    const round = room.round;
    try {
      const scored = await Promise.all(
        round.racers.map(async (playerId): Promise<Omit<RoomScoreRow, 'rank' | 'tied'>> => {
          const submission = round.submissions[playerId];
          const player = findPlayer(room, playerId);
          const name = player?.name ?? 'Player';

          const evaluation = await evaluateRound(
            {
              letter: round.letter,
              answers: submission.answers,
              bonusChallenge: round.bonusChallenge,
              timeTakenSeconds: submission.timeTakenSeconds,
            },
            judge
          );

          return {
            playerId,
            name,
            totalScore: evaluation.totalScore,
            speedBonus: evaluation.speedBonus,
            timeTakenSeconds: submission.timeTakenSeconds,
            auto: submission.auto,
            answers: submission.answers,
            categories: evaluation.categories,
            judgedBy: evaluation.judgedBy,
          };
        })
      );

      const rows = rankRows(scored) as RoomScoreRow[];
      room.results = { rows, endedBy: round.endedBy ?? 'clock' };
      recordResults(room, rows);
      room.phase = 'reveal';
    } finally {
      room.judging = false;
    }
  }

  /** Advances a racing room past its deadline and judges it if the round is over. */
  async function advance(room: Room): Promise<void> {
    maybeEndRound(room, now());
    if (room.phase === 'judging') await judgeRound(room);
  }

  return {
    async create(playerId: string, name: string): Promise<RoomView> {
      const at = now();

      // Four characters is ~1M codes; collisions are handled rather than assumed away.
      let code = generateRoomCode();
      for (let attempt = 0; attempt < 8 && (await store.get(code)); attempt++) {
        code = generateRoomCode();
      }
      if (await store.get(code)) throw new RoomError('Could not allocate a room code.', 503);

      const room = createRoom(code, at);
      join(room, playerId, name, at);
      await store.create(room);
      return toView(room, playerId, at);
    },

    async join(code: string, playerId: string, name: string): Promise<RoomView> {
      const room = await load(code);
      join(room, playerId, name, now());
      await store.put(room);
      return toView(room, playerId, now());
    },

    /** The polling endpoint: also what keeps a player marked present. */
    async view(code: string, playerId: string): Promise<RoomView> {
      const room = await load(code);
      touch(room, playerId, now());
      await advance(room);
      await store.put(room);
      return toView(room, playerId, now());
    },

    async start(code: string, playerId: string): Promise<RoomView> {
      const room = await load(code);
      touch(room, playerId, now());

      const puzzle = await nextPuzzle(room.round?.letter);
      startRound(room, playerId, puzzle.letter, puzzle.bonusChallenge, now());
      await store.put(room);
      return toView(room, playerId, now());
    },

    /** The host choosing how long the match runs, before the first round. */
    async setRounds(code: string, playerId: string, totalRounds: number): Promise<RoomView> {
      const room = await load(code);
      touch(room, playerId, now());
      setTotalRounds(room, playerId, totalRounds);
      await store.put(room);
      return toView(room, playerId, now());
    },

    /** Wipes the standings and lets the host set the length again. */
    async newMatch(code: string, playerId: string): Promise<RoomView> {
      const room = await load(code);
      touch(room, playerId, now());
      newMatch(room, playerId);
      await store.put(room);
      return toView(room, playerId, now());
    },

    async submit(code: string, playerId: string, answers: UserAnswers): Promise<RoomView> {
      const room = await load(code);
      touch(room, playerId, now());
      submit(room, playerId, answers, now());
      await advance(room);
      await store.put(room);
      return toView(room, playerId, now());
    },

    async next(code: string, playerId: string): Promise<RoomView> {
      const room = await load(code);
      touch(room, playerId, now());
      backToLobby(room, playerId);
      await store.put(room);
      return toView(room, playerId, now());
    },

    async leave(code: string, playerId: string): Promise<void> {
      const room = await load(code).catch(() => null);
      if (!room) return;
      const player = findPlayer(room, playerId);
      if (player) {
        player.present = false;
        reapAbsent(room, now());
        await store.put(room);
      }
    },
  };
}

export type RoomService = ReturnType<typeof createRoomService>;
