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
  /**
   * Settles a knowledge-based bonus rule once for the whole round.
   *
   * Optional: without one every player keeps their own judge's ruling, which is
   * the degraded behaviour rather than an error.
   */
  bonusAdjudicator?: BonusAdjudicator;
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
 * How hard the publish tries before giving up.
 *
 * Higher than the rest, because losing this race is not like losing any other:
 * the model call has already been made and paid for, and dropping its results
 * leaves the room stuck in `judging` until the claim goes stale and the whole
 * round is judged again.
 */
const MAX_PUBLISH_ATTEMPTS = 12;

/** The secret a seat is proved with. Server-issued, so a client cannot pick it. */
function newSeatToken(): string {
  return randomUUID();
}

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
  bonusAdjudicator,
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
   * moved on, and its job is to state the change again against that room. It may
   * also report that nothing needs saving, and then no write is attempted at all:
   * a poll that only restates what the store already says is pure contention for
   * every other writer, and the judging publish is the writer that must not lose.
   */
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

  /**
   * Brings a room up to date for a reader, saving only when that changed something.
   *
   * The reap and the deadline are re-derived on every load, so a view is correct
   * whether or not the last one was written down; what has to reach the store is
   * a heartbeat fresh enough to keep the seat, and a round that has ended.
   */
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

  /**
   * Judges every racer, in parallel, each exactly as a solo round is judged.
   *
   * Independent calls are only safe because duplicate answers do not score less:
   * no player's score depends on another's. It also keeps one player's content
   * filter rejection from taking down everyone else's round.
   *
   * ⚠️ The bonus rule is the one thing that cannot be left to those independent
   * calls. A rule needing world knowledge — "two answers must relate to a colour"
   * — is not mechanically decidable, so `enforceBonusRule` hands it back to the
   * model, and the model applied it differently to each player: two players in
   * one round, answering equally well, were seen getting different bonus
   * verdicts. So it is settled ONCE for the round, over everybody's answers
   * together, and that ruling is applied to every player.
   */
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

  /**
   * Takes the judging if it is going spare, and sees it through.
   *
   * ⚠️ The claim is written before the model is called, and it is checked again —
   * against the round it was taken for — before the results are published.
   * Judging adds a round to the standings, so publishing twice, or publishing
   * into the wrong round, is damage no later write can undo.
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

    // Which round these results describe. A claim that goes stale mid-call may
    // come back to a room that is judging an entirely different round.
    const judgedRound = claimed.round?.number ?? 0;
    const results = await scoreRound(claimed);

    try {
      await mutate(
        code,
        (current) => {
          // The claim goes stale on a slow model call, so another replica may
          // have published this round already, and the match may have moved on
          // to the next one. Either way these results no longer belong here.
          if (!claimStillHolds(current, judgedRound)) return;
          publishResults(current, results);
        },
        { attempts: MAX_PUBLISH_ATTEMPTS }
      );
    } catch (err) {
      // Nothing left to do but let the claim go stale so someone judges again;
      // swallowing it would tell the caller their round was fine when it is not.
      console.error(`Publishing round ${judgedRound} of room ${code} failed:`, err);
      throw err;
    }
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
      // Minted once, outside the retry: a redo must hand the caller back the same
      // seat token it is about to be told to use.
      const token = newSeatToken();

      // Four characters is ~1M codes; collisions are handled rather than assumed
      // away, and against a shared store the only reliable test is the write.
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

        // The code is taken. If it is held by a room that has already expired,
        // take it over rather than walking past it — otherwise every room that
        // was created and abandoned narrows the pool for good.
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

    /**
     * Takes a seat, or reclaims the one this browser already holds.
     *
     * A returning player presents the token they were issued — a refresh looks
     * exactly like leaving, so reclaiming a seat has to be possible — and anyone
     * presenting the wrong one is refused rather than handed the seat.
     */
    async join(code: string, playerId: string, name: string, token?: string): Promise<RoomView> {
      const seatToken = token?.trim() || newSeatToken();

      const { room } = await mutate(code, (current) =>
        join(current, playerId, name, now(), seatToken)
      );
      return withToken(toView(room, playerId, now()), seatToken);
    },

    /** The polling endpoint: also what keeps a player marked present. */
    async view(code: string, seat: PlayerSeat): Promise<RoomView> {
      const room = await readAndAdvance(code, seat);
      return toView(await advance(code, room), seat.playerId, now());
    },

    async start(code: string, seat: PlayerSeat): Promise<RoomView> {
      const existing = await load(code);

      // ⚠️ Checked against the room as read, before a puzzle is drawn. Drawing one
      // is an AI call, and doing it first meant any caller who could name a live
      // room code could spend one per request and be told 403 afterwards. The
      // authority is still `startRound` inside the mutate — this only refuses
      // early what would certainly be refused late.
      const player = authorize(existing.room, seat);
      if (!player.isHost) throw new RoomError('Only the host can start a round.', 403);
      if (existing.room.phase !== 'lobby') throw new RoomError('A round is already running.', 409);
      if (existing.room.roundsPlayed >= existing.room.totalRounds) {
        throw new RoomError('This match is over. Start a new match to keep playing.', 409);
      }

      // Drawn before the room is touched: a redo must not spend another model
      // call, nor hand the room a different letter the second time around.
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
        // ⚠️ The token is what stops one player submitting for another. Ids are
        // public, and `submit` is idempotent, so an impersonated blank submission
        // would have silently discarded the real one when it arrived.
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

    /** The host choosing how long the match runs, before the first round. */
    async setRounds(code: string, seat: PlayerSeat, totalRounds: number): Promise<RoomView> {
      const { room } = await mutate(code, (current) => {
        authorize(current, seat);
        touch(current, seat.playerId, now());
        setTotalRounds(current, seat.playerId, totalRounds);
      });
      return toView(room, seat.playerId, now());
    },

    /** Wipes the standings and lets the host set the length again. */
    async newMatch(code: string, seat: PlayerSeat): Promise<RoomView> {
      const { room } = await mutate(code, (current) => {
        authorize(current, seat);
        touch(current, seat.playerId, now());
        newMatch(current, seat.playerId);
      });
      return toView(room, seat.playerId, now());
    },

    async leave(code: string, seat: PlayerSeat): Promise<void> {
      // Best effort: the room also drops players who stop polling, so a room that
      // has already closed under them is nothing to report.
      await mutate(code, (current) => {
        // ⚠️ Authorised like everything else. Without the token, "leave" was a way
        // to mark a rival absent: the round then stops waiting for them and they
        // are scored blank.
        const player = authorize(current, seat);
        player.present = false;
        reapAbsent(current, now());
      }).catch(() => undefined);
    },
  };
}

/** Attaches the caller's seat token — only ever to the reply that issued it. */
function withToken(view: RoomView, token: string): RoomView {
  return { ...view, youToken: token };
}

export type RoomService = ReturnType<typeof createRoomService>;
