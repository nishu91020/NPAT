import { randomUUID } from 'crypto';
import type {
  BonusChallenge,
  RoomResults,
  RoomScoreRow,
  RoomView,
  UserAnswers,
} from '../../shared/contract';
import { evaluateRound, sharedBonusRuling, type BonusAdjudicator, type Judge } from '../referee';
import { createMemoryRoomStore } from './memoryStore';
import {
  RoomError,
  authorize,
  backToLobby,
  canClaimJudging,
  claimJudging,
  claimStillHolds,
  canSetRounds,
  createRoom,
  findPlayer,
  generateRoomCode,
  isExpired,
  isMatchComplete,
  join,
  maybeEndRound,
  newMatch,
  publishResults,
  rankRows,
  reapAbsent,
  setTotalRounds,
  startRound,
  submit,
  toView,
  touch,
} from './roomState';
import {
  RoomVersionConflict,
  type PlayerSeat,
  type Room,
  type RoomStore,
  type StoredRoom,
} from './types';

export interface RoomServiceDeps {
  store?: RoomStore;
  judge: Judge;

  bonusAdjudicator?: BonusAdjudicator;

  nextPuzzle: (excludeLetter?: string) => Promise<{ letter: string; bonusChallenge: BonusChallenge }>;
  now?: () => number;
}

const MAX_WRITE_ATTEMPTS = 6;

const MAX_PUBLISH_ATTEMPTS = 12;

function newSeatToken(): string {
  return randomUUID();
}

export function createRoomService({
  store = createMemoryRoomStore(),
  judge,
  bonusAdjudicator,
  nextPuzzle,
  now = () => Date.now(),
}: RoomServiceDeps) {

  async function load(code: string): Promise<StoredRoom> {
    const stored = await store.get(code.toUpperCase());
    if (!stored) throw new RoomError('That room does not exist.', 404);

    const at = now();
    reapAbsent(stored.room, at);

    if (isExpired(stored.room, at)) {
      await store.delete(stored.room.code);
      throw new RoomError('That room has closed.', 404);
    }

    return stored;
  }

  async function freeIfDead(code: string): Promise<boolean> {
    const stored = await store.get(code);
    if (!stored) return true;

    const at = now();
    reapAbsent(stored.room, at);
    if (!isExpired(stored.room, at)) return false;

    await store.delete(code);
    return true;
  }

  async function mutate<T>(
    code: string,
    apply: (room: Room) => T,
    {
      attempts = MAX_WRITE_ATTEMPTS,
      worthSaving = () => true,
    }: { attempts?: number; worthSaving?: (result: T, room: Room) => boolean } = {}
  ): Promise<{ room: Room; result: T }> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const stored = await load(code);
      const result = apply(stored.room);

      if (!worthSaving(result, stored.room)) return { room: stored.room, result };

      try {
        await store.put(stored);
        return { room: stored.room, result };
      } catch (err) {
        if (!(err instanceof RoomVersionConflict)) throw err;
      }
    }

    throw new RoomError('That room is busy right now. Try again.', 409);
  }

  async function readAndAdvance(code: string, seat: PlayerSeat): Promise<Room> {
    const { room } = await mutate(code, (current) => {
      authorize(current, seat);
      const before = current.phase;
      const beat = touch(current, seat.playerId, now());
      maybeEndRound(current, now());
      return beat || current.phase !== before;
    }, { worthSaving: (changed) => changed });

    return room;
  }

  async function scoreRound(room: Room): Promise<RoomResults> {
    const round = room.round;
    if (!round) throw new RoomError('No round to judge.', 409);

    const ruling = await sharedBonusRuling(bonusAdjudicator, {
      letter: round.letter,
      bonusChallenge: round.bonusChallenge,
      submissions: round.racers.map((playerId) => round.submissions[playerId].answers),
    });

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
          judge,
          ruling
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

    return { rows: rankRows(scored) as RoomScoreRow[], endedBy: round.endedBy ?? 'clock' };
  }

  async function judgeIfUnclaimed(code: string): Promise<void> {
    let claimed: Room;
    try {
      const { room, result: mine } = await mutate(code, (current) => {
        if (!canClaimJudging(current, now())) return false;
        claimJudging(current, now());
        return true;
      });
      if (!mine) return;
      claimed = room;
    } catch (err) {

      if (err instanceof RoomError) return;
      throw err;
    }

    const judgedRound = claimed.round?.number ?? 0;
    const results = await scoreRound(claimed);

    try {
      await mutate(
        code,
        (current) => {

          if (!claimStillHolds(current, judgedRound)) return;
          publishResults(current, results);
        },
        { attempts: MAX_PUBLISH_ATTEMPTS }
      );
    } catch (err) {

      console.error(`Publishing round ${judgedRound} of room ${code} failed:`, err);
      throw err;
    }
  }

  async function afterJudging(code: string, room: Room): Promise<Room> {
    if (room.phase !== 'judging') return room;
    const stored = await store.get(code.toUpperCase());
    return stored?.room ?? room;
  }

  async function advance(code: string, room: Room): Promise<Room> {
    if (room.phase !== 'judging') return room;
    await judgeIfUnclaimed(code);
    return afterJudging(code, room);
  }

  return {
    async create(playerId: string, name: string): Promise<RoomView> {

      const token = newSeatToken();

      for (let attempt = 0; attempt < 8; attempt++) {
        const at = now();
        const room = createRoom(generateRoomCode(), at);
        join(room, playerId, name, at, token);

        try {
          await store.create(room);
          return withToken(toView(room, playerId, at), token);
        } catch (err) {
          if (!(err instanceof RoomVersionConflict)) throw err;
        }

        if (await freeIfDead(room.code)) {
          try {
            await store.create(room);
            return withToken(toView(room, playerId, at), token);
          } catch (err) {
            if (!(err instanceof RoomVersionConflict)) throw err;
          }
        }
      }

      throw new RoomError('Could not allocate a room code.', 503);
    },

    async join(code: string, playerId: string, name: string, token?: string): Promise<RoomView> {
      const seatToken = token?.trim() || newSeatToken();

      const { room } = await mutate(code, (current) =>
        join(current, playerId, name, now(), seatToken)
      );
      return withToken(toView(room, playerId, now()), seatToken);
    },

    async view(code: string, seat: PlayerSeat): Promise<RoomView> {
      const room = await readAndAdvance(code, seat);
      return toView(await advance(code, room), seat.playerId, now());
    },

    async start(code: string, seat: PlayerSeat): Promise<RoomView> {
      const existing = await load(code);

      const player = authorize(existing.room, seat);
      if (!player.isHost) throw new RoomError('Only the host can start a round.', 403);
      if (existing.room.phase !== 'lobby') throw new RoomError('A round is already running.', 409);
      if (existing.room.roundsPlayed >= existing.room.totalRounds) {
        throw new RoomError('This match is over. Start a new match to keep playing.', 409);
      }

      const puzzle = await nextPuzzle(existing.room.round?.letter);

      const { room } = await mutate(code, (current) => {
        authorize(current, seat);
        touch(current, seat.playerId, now());
        startRound(current, seat.playerId, puzzle.letter, puzzle.bonusChallenge, now());
      });

      return toView(room, seat.playerId, now());
    },

    async submit(code: string, seat: PlayerSeat, answers: UserAnswers): Promise<RoomView> {
      const { room } = await mutate(code, (current) => {

        authorize(current, seat);
        touch(current, seat.playerId, now());
        submit(current, seat.playerId, answers, now());
      });

      return toView(await advance(code, room), seat.playerId, now());
    },

    async next(code: string, seat: PlayerSeat): Promise<RoomView> {
      const { room } = await mutate(code, (current) => {
        authorize(current, seat);
        touch(current, seat.playerId, now());
        backToLobby(current, seat.playerId);
      });
      return toView(room, seat.playerId, now());
    },

    async setRounds(code: string, seat: PlayerSeat, totalRounds: number): Promise<RoomView> {
      const { room } = await mutate(code, (current) => {
        authorize(current, seat);
        touch(current, seat.playerId, now());
        setTotalRounds(current, seat.playerId, totalRounds);
      });
      return toView(room, seat.playerId, now());
    },

    async newMatch(code: string, seat: PlayerSeat): Promise<RoomView> {
      const { room } = await mutate(code, (current) => {
        authorize(current, seat);
        touch(current, seat.playerId, now());
        newMatch(current, seat.playerId);
      });
      return toView(room, seat.playerId, now());
    },

    async leave(code: string, seat: PlayerSeat): Promise<void> {

      await mutate(code, (current) => {

        const player = authorize(current, seat);
        player.present = false;
        reapAbsent(current, now());
      }).catch(() => undefined);
    },
  };
}

function withToken(view: RoomView, token: string): RoomView {
  return { ...view, youToken: token };
}

export type RoomService = ReturnType<typeof createRoomService>;
