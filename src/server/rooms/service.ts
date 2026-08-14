import type {
  BonusChallenge,
  RoomResults,
  RoomScoreRow,
  RoomView,
  UserAnswers,
} from '../../shared/contract';
import { evaluateRound, type Judge } from '../referee';
import { createMemoryRoomStore } from './memoryStore';
import {
  RoomError,
  backToLobby,
  canClaimJudging,
  claimJudging,
  createRoom,
  findPlayer,
  generateRoomCode,
  isExpired,
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
import { RoomVersionConflict, type Room, type RoomStore, type StoredRoom } from './types';

export interface RoomServiceDeps {
  store?: RoomStore;
  judge: Judge;
  /** Supplies the letter and bonus challenge for each round. */
  nextPuzzle: (excludeLetter?: string) => Promise<{ letter: string; bonusChallenge: BonusChallenge }>;
  now?: () => number;
}

/**
 * How many times a change is redone when another writer got in first.
 *
 * Contention is bounded by the room: at most eight players, each polling. A
 * handful of attempts covers a realistic pile-up, and giving up beats spinning —
 * the caller is polling anyway and will be back in a moment.
 */
const MAX_WRITE_ATTEMPTS = 6;

/**
 * The room service — everything the HTTP layer needs, and nothing about HTTP.
 *
 * Rooms advance **lazily, when read**. There is no timer and no sweeper, because
 * the app scales to zero and a background job would keep a replica alive purely
 * to watch a clock. Every entry point loads the room, advances it to `now`, acts,
 * and saves.
 *
 * ⚠️ Every save is conditional on the version the room was read at, and a change
 * that loses that race is **redone against fresh state** rather than forced
 * through. Two players in one room can be served by different replicas, so a
 * blind write would silently drop whatever the other one had just recorded — a
 * submission, a join, an entire round. That is also why every change is expressed
 * as a synchronous function of the room: it has to be safe to run again.
 */
export function createRoomService({
  store = createMemoryRoomStore(),
  judge,
  nextPuzzle,
  now = () => Date.now(),
}: RoomServiceDeps) {
  /** Loads a room and brings it up to date, or throws if it is gone. */
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

  /**
   * Frees a code whose room is dead, and says whether it is now free.
   *
   * ⚠️ Rooms expire lazily, on read — and nothing ever reads a room everybody has
   * walked away from. A room that was created and never played therefore keeps
   * its code for as long as the store lives, long after the room itself has
   * expired. Creation is the one moment that cares, so creation is what clears
   * them up: a code is only refused by a room that is still alive.
   */
  async function freeIfDead(code: string): Promise<boolean> {
    const stored = await store.get(code);
    if (!stored) return true;

    const at = now();
    reapAbsent(stored.room, at);
    if (!isExpired(stored.room, at)) return false;

    await store.delete(code);
    return true;
  }

  /**
   * Load, change, save — redone from a fresh read when someone else saved first.
   *
   * `apply` must be safe to run more than once: it is handed a room that may have
   * moved on, and its job is to state the change again against that room.
   */
  async function mutate<T>(
    code: string,
    apply: (room: Room) => T
  ): Promise<{ room: Room; result: T }> {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const stored = await load(code);
      const result = apply(stored.room);

      try {
        await store.put(stored);
        return { room: stored.room, result };
      } catch (err) {
        if (!(err instanceof RoomVersionConflict)) throw err;
      }
    }

    throw new RoomError('That room is busy right now. Try again.', 409);
  }

  /**
   * Judges every racer, in parallel, each exactly as a solo round is judged.
   *
   * Independent calls are only safe because duplicate answers do not score less:
   * no player's score depends on another's. It also keeps one player's content
   * filter rejection from taking down everyone else's round.
   */
  async function scoreRound(room: Room): Promise<RoomResults> {
    const round = room.round;
    if (!round) throw new RoomError('No round to judge.', 409);

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

    return { rows: rankRows(scored) as RoomScoreRow[], endedBy: round.endedBy ?? 'clock' };
  }

  /**
   * Takes the judging if it is going spare, and sees it through.
   *
   * ⚠️ The claim is written before the model is called, and the phase is checked
   * again before the results are published. Judging adds a round to the standings,
   * so a second replica doing it in parallel would score the round twice — and
   * unlike a lost write, that damage is permanent.
   */
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
      // Losing the claim is not a failure worth showing anyone: whoever won it is
      // judging, and the next poll finds the results.
      if (err instanceof RoomError) return;
      throw err;
    }

    const results = await scoreRound(claimed);

    await mutate(code, (current) => {
      // The claim goes stale on a slow model call, so another replica may have
      // published already. Whoever got there first is the one that counts.
      if (current.phase !== 'judging') return;
      publishResults(current, results);
    });
  }

  /**
   * Re-reads a room the judging may have moved on, so the caller who triggered it
   * sees the results instead of being told to poll for what already exists.
   */
  async function afterJudging(code: string, room: Room): Promise<Room> {
    if (room.phase !== 'judging') return room;
    const stored = await store.get(code.toUpperCase());
    return stored?.room ?? room;
  }

  /** Judges the round if it has just ended, then reports where the room got to. */
  async function advance(code: string, room: Room): Promise<Room> {
    if (room.phase !== 'judging') return room;
    await judgeIfUnclaimed(code);
    return afterJudging(code, room);
  }

  return {
    async create(playerId: string, name: string): Promise<RoomView> {
      // Four characters is ~1M codes; collisions are handled rather than assumed
      // away, and against a shared store the only reliable test is the write.
      for (let attempt = 0; attempt < 8; attempt++) {
        const at = now();
        const room = createRoom(generateRoomCode(), at);
        join(room, playerId, name, at);

        try {
          await store.create(room);
          return toView(room, playerId, at);
        } catch (err) {
          if (!(err instanceof RoomVersionConflict)) throw err;
        }

        // The code is taken. If it is held by a room that has already expired,
        // take it over rather than walking past it — otherwise every room that
        // was created and abandoned narrows the pool for good.
        if (await freeIfDead(room.code)) {
          try {
            await store.create(room);
            return toView(room, playerId, at);
          } catch (err) {
            if (!(err instanceof RoomVersionConflict)) throw err;
          }
        }
      }

      throw new RoomError('Could not allocate a room code.', 503);
    },

    async join(code: string, playerId: string, name: string): Promise<RoomView> {
      const { room } = await mutate(code, (current) => join(current, playerId, name, now()));
      return toView(room, playerId, now());
    },

    /** The polling endpoint: also what keeps a player marked present. */
    async view(code: string, playerId: string): Promise<RoomView> {
      const { room } = await mutate(code, (current) => {
        touch(current, playerId, now());
        maybeEndRound(current, now());
      });

      return toView(await advance(code, room), playerId, now());
    },

    async start(code: string, playerId: string): Promise<RoomView> {
      // Drawn before the room is touched: a redo must not spend another model
      // call, nor hand the room a different letter the second time around.
      const existing = await load(code);
      const puzzle = await nextPuzzle(existing.room.round?.letter);

      const { room } = await mutate(code, (current) => {
        touch(current, playerId, now());
        startRound(current, playerId, puzzle.letter, puzzle.bonusChallenge, now());
      });

      return toView(room, playerId, now());
    },

    async submit(code: string, playerId: string, answers: UserAnswers): Promise<RoomView> {
      const { room } = await mutate(code, (current) => {
        touch(current, playerId, now());
        submit(current, playerId, answers, now());
      });

      return toView(await advance(code, room), playerId, now());
    },

    async next(code: string, playerId: string): Promise<RoomView> {
      const { room } = await mutate(code, (current) => {
        touch(current, playerId, now());
        backToLobby(current, playerId);
      });
      return toView(room, playerId, now());
    },

    /** The host choosing how long the match runs, before the first round. */
    async setRounds(code: string, playerId: string, totalRounds: number): Promise<RoomView> {
      const { room } = await mutate(code, (current) => {
        touch(current, playerId, now());
        setTotalRounds(current, playerId, totalRounds);
      });
      return toView(room, playerId, now());
    },

    /** Wipes the standings and lets the host set the length again. */
    async newMatch(code: string, playerId: string): Promise<RoomView> {
      const { room } = await mutate(code, (current) => {
        touch(current, playerId, now());
        newMatch(current, playerId);
      });
      return toView(room, playerId, now());
    },

    async leave(code: string, playerId: string): Promise<void> {
      // Best effort: the room also drops players who stop polling, so a room that
      // has already closed under them is nothing to report.
      await mutate(code, (current) => {
        const player = findPlayer(current, playerId);
        if (player) player.present = false;
        reapAbsent(current, now());
      }).catch(() => undefined);
    },
  };
}

export type RoomService = ReturnType<typeof createRoomService>;
