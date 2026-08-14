import { describe, expect, it } from 'vitest';
import type { BonusChallenge, UserAnswers } from '../../shared/contract';
import { createRoomService } from './service';
import { createMemoryRoomStore } from './memoryStore';
import {
  RoomError,
  backToLobby,
  canSetRounds,
  createRoom,
  generateRoomCode,
  isMatchComplete,
  join,
  leave,
  maybeEndRound,
  newMatch,
  rankRows,
  reapAbsent,
  recordResults,
  setTotalRounds,
  standingsOf,
  startRound,
  submit,
  isExpired,
  toView,
  touch,
} from './roomState';
import { ROOM_RULES, RoomVersionConflict } from './types';
import type { Judge } from '../referee';

const CHALLENGE: BonusChallenge = {
  id: 'test',
  title: 'Test',
  description: 'Test challenge',
  icon: 'Sparkles',
  ruleHint: 'test',
};

const GOOD: UserAnswers = { name: 'Sam', place: 'Spain', animal: 'Snake', thing: 'Spoon' };

const T0 = 1_000_000;
const sec = (n: number) => T0 + n * 1000;

function roomWith(names: string[]) {
  const room = createRoom('TEST', T0);
  names.forEach((name, i) => join(room, `p${i + 1}`, name, T0));
  return room;
}

describe('room codes', () => {
  it('avoids characters that are ambiguous when read aloud', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateRoomCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    }
  });
});

describe('the round ends when everyone has submitted or the timer expires', () => {
  it('ends as soon as every racer has submitted, before the clock', () => {
    const room = roomWith(['Ana', 'Ben']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);

    submit(room, 'p1', GOOD, sec(10));
    expect(room.phase).toBe('racing');

    submit(room, 'p2', GOOD, sec(14));
    expect(room.phase).toBe('judging');
    expect(room.round?.endedBy).toBe('all-submitted');
  });

  it('ends on the deadline when someone never submits, taking their answers as they stand', () => {
    const room = roomWith(['Ana', 'Ben']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    submit(room, 'p1', GOOD, sec(12));

    maybeEndRound(room, sec(ROOM_RULES.roundSeconds + ROOM_RULES.submitGraceSeconds + 1));

    expect(room.phase).toBe('judging');
    expect(room.round?.endedBy).toBe('clock');
    expect(room.round?.submissions.p2.auto).toBe(true);
  });

  it('holds the round open past the deadline so a timeout auto-submit still lands', () => {
    const room = roomWith(['Ana', 'Ben']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    submit(room, 'p1', GOOD, sec(12));

    // A poll arriving the instant the clock hits zero must not throw away the
    // answers every client is auto-submitting at exactly that moment.
    maybeEndRound(room, sec(ROOM_RULES.roundSeconds));
    expect(room.phase).toBe('racing');

    submit(room, 'p2', GOOD, sec(ROOM_RULES.roundSeconds + 1));

    expect(room.round?.submissions.p2.answers).toEqual(GOOD);
    expect(room.round?.submissions.p2.auto).toBe(true);
    expect(room.round?.submissions.p2.timeTakenSeconds).toBe(ROOM_RULES.roundSeconds);
    expect(room.phase).toBe('judging');
  });

  it('does not claim everyone finished when the clock submitted for someone', () => {
    const room = roomWith(['Ana', 'Ben']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    submit(room, 'p1', GOOD, sec(12));
    submit(room, 'p2', GOOD, sec(ROOM_RULES.roundSeconds + 1));

    expect(room.round?.endedBy).toBe('clock');
  });

  it('refuses a submission that arrives after the grace window has passed', () => {
    const room = roomWith(['Ana', 'Ben']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);

    expect(() =>
      submit(room, 'p1', GOOD, sec(ROOM_RULES.roundSeconds + ROOM_RULES.submitGraceSeconds + 1))
    ).toThrow(/over/i);
    expect(room.round?.submissions.p1).toBeUndefined();
  });

  it('does not wait for a player who has gone', () => {
    const room = roomWith(['Ana', 'Ben']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    submit(room, 'p1', GOOD, sec(5));

    leave(room, 'p2', sec(6));
    maybeEndRound(room, sec(7));

    expect(room.phase).toBe('judging');
  });

  it('does not claim everyone finished when someone merely went quiet', () => {
    const room = roomWith(['Ana', 'Ben']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    submit(room, 'p1', GOOD, sec(5));

    // Ben never answers and stops polling — the room stops waiting on him, but
    // telling Ana that everyone finished would be a lie.
    leave(room, 'p2', sec(6));
    maybeEndRound(room, sec(7));

    expect(room.round?.endedBy).toBe('clock');
    expect(room.round?.submissions.p2.auto).toBe(true);
  });

  it('never reports a time longer than the round, however late the poll arrives', () => {
    const room = roomWith(['Ana', 'Ben']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    submit(room, 'p1', GOOD, sec(5));

    // Nobody looks at the room until well after the deadline.
    maybeEndRound(room, sec(ROOM_RULES.roundSeconds + 45));

    expect(room.round?.submissions.p2.timeTakenSeconds).toBe(ROOM_RULES.roundSeconds);
  });
});

describe('submissions', () => {
  it('is idempotent, so a retry or a double-click cannot score twice', () => {
    const room = roomWith(['Ana', 'Ben']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);

    submit(room, 'p1', GOOD, sec(5));
    submit(room, 'p1', { name: 'Sxx', place: '', animal: '', thing: '' }, sec(20));

    expect(room.round?.submissions.p1.answers.name).toBe('Sam');
    expect(room.round?.submissions.p1.timeTakenSeconds).toBe(5);
  });

  it('is timed by the server, not by the client', () => {
    const room = roomWith(['Ana']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    submit(room, 'p1', GOOD, sec(23));
    expect(room.round?.submissions.p1.timeTakenSeconds).toBe(23);
  });

  it('refuses a player who is not in the round', () => {
    const room = roomWith(['Ana']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    join(room, 'late', 'Late', sec(5));
    expect(() => submit(room, 'late', GOOD, sec(6))).toThrow(RoomError);
  });
});

describe('the leaderboard', () => {
  it('ranks on score and breaks ties on time', () => {
    const ranked = rankRows([
      { name: 'Slow', totalScore: 60, timeTakenSeconds: 40 },
      { name: 'Fast', totalScore: 60, timeTakenSeconds: 5 },
      { name: 'Best', totalScore: 80, timeTakenSeconds: 30 },
    ]);
    expect(ranked.map((r) => r.name)).toEqual(['Best', 'Fast', 'Slow']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('lets players level on both score and time share a rank, then skips one', () => {
    const ranked = rankRows([
      { name: 'A', totalScore: 50, timeTakenSeconds: 20 },
      { name: 'B', totalScore: 50, timeTakenSeconds: 20 },
      { name: 'C', totalScore: 10, timeTakenSeconds: 40 },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(ranked[1].tied).toBe(true);
  });

  // ⚠️ A tie has two sides. Flagging only the second told the leader they had won
  // outright while showing the player level with them as tied.
  it('marks every side of a tie, not just the ones after the first', () => {
    const ranked = rankRows([
      { name: 'A', totalScore: 50, timeTakenSeconds: 20 },
      { name: 'B', totalScore: 50, timeTakenSeconds: 20 },
      { name: 'C', totalScore: 50, timeTakenSeconds: 20 },
      { name: 'D', totalScore: 10, timeTakenSeconds: 40 },
    ]);
    expect(ranked.map((r) => r.tied)).toEqual([true, true, true, false]);
  });

  it('does not call a player tied with someone they merely beat on time', () => {
    const ranked = rankRows([
      { name: 'Fast', totalScore: 50, timeTakenSeconds: 5 },
      { name: 'Slow', totalScore: 50, timeTakenSeconds: 20 },
    ]);
    expect(ranked.map((r) => r.tied)).toEqual([false, false]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
  });
});

describe('presence and the room lifecycle', () => {
  it('lets a refreshing player reclaim their seat rather than joining twice', () => {
    const room = roomWith(['Ana']);
    leave(room, 'p1', sec(1));
    join(room, 'p1', 'Ana', sec(3));

    expect(room.players).toHaveLength(1);
    expect(room.players[0].present).toBe(true);
    expect(room.players[0].isHost).toBe(true);
  });

  it('does not close the instant the last player leaves, so a refresh survives', () => {
    const room = roomWith(['Ana']);
    leave(room, 'p1', sec(1));

    expect(isExpired(room, sec(2))).toBe(false);
    expect(isExpired(room, sec(1 + ROOM_RULES.emptyGraceSeconds + 1))).toBe(true);
  });

  it('drops a player who has stopped polling', () => {
    const room = roomWith(['Ana', 'Ben']);
    touch(room, 'p1', sec(100));
    reapAbsent(room, sec(100));

    expect(room.players.find((p) => p.id === 'p2')?.present).toBe(false);
    expect(room.players.find((p) => p.id === 'p1')?.present).toBe(true);
  });

  it('moves the host on when the host goes, so the room is never stuck', () => {
    const room = roomWith(['Ana', 'Ben', 'Cal']);
    expect(room.players[0].isHost).toBe(true);

    leave(room, 'p1', sec(1));

    expect(room.players.find((p) => p.id === 'p2')?.isHost).toBe(true);
    expect(room.players.filter((p) => p.present && p.isHost)).toHaveLength(1);
  });

  it('refuses a ninth player', () => {
    const room = createRoom('FULL', T0);
    for (let i = 0; i < ROOM_RULES.maxPlayers; i++) join(room, `p${i}`, `P${i}`, T0);
    expect(() => join(room, 'extra', 'Extra', T0)).toThrow(/full/i);
  });

  it('only lets the host start a round', () => {
    const room = roomWith(['Ana', 'Ben']);
    expect(() => startRound(room, 'p2', 'S', CHALLENGE, T0)).toThrow(RoomError);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    expect(room.phase).toBe('racing');
  });

  it('keeps a late joiner out of the round in progress but in the next one', () => {
    const room = roomWith(['Ana', 'Ben']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    join(room, 'late', 'Late', sec(5));

    expect(room.round?.racers).not.toContain('late');

    submit(room, 'p1', GOOD, sec(6));
    submit(room, 'p2', GOOD, sec(7));
    expect(room.phase).toBe('judging');
  });
});

describe('the match length', () => {
  it('is the host default until the host picks another', () => {
    const room = roomWith(['Ana']);
    expect(room.totalRounds).toBe(ROOM_RULES.defaultRounds);

    setTotalRounds(room, 'p1', 5);
    expect(room.totalRounds).toBe(5);
  });

  it('is only the host to set', () => {
    const room = roomWith(['Ana', 'Ben']);
    expect(() => setTotalRounds(room, 'p2', 5)).toThrow(/host/i);
  });

  it('refuses a length that was never offered', () => {
    const room = roomWith(['Ana']);
    expect(() => setTotalRounds(room, 'p1', 7)).toThrow(RoomError);
    expect(() => setTotalRounds(room, 'p1', 0)).toThrow(RoomError);
  });

  it('is locked once the first round has started, so the finish line cannot move', () => {
    const room = roomWith(['Ana']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    expect(canSetRounds(room)).toBe(false);
    expect(() => setTotalRounds(room, 'p1', 10)).toThrow(/started/i);
  });

  it('ends the match after the last round, rather than offering another', () => {
    const room = roomWith(['Ana']);
    setTotalRounds(room, 'p1', 1);

    startRound(room, 'p1', 'S', CHALLENGE, T0);
    submit(room, 'p1', GOOD, sec(5));
    room.phase = 'reveal'; // Judging is the service's job, not the state machine's.

    expect(isMatchComplete(room)).toBe(true);
    expect(toView(room, 'p1', sec(6)).matchComplete).toBe(true);
    expect(() => backToLobby(room, 'p1')).toThrow(/match is over/i);
  });

  it('starts a new match with a clean scoreboard and the length open again', () => {
    const room = roomWith(['Ana']);
    setTotalRounds(room, 'p1', 1);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    submit(room, 'p1', GOOD, sec(5));
    room.phase = 'reveal';
    recordResults(room, [
      {
        playerId: 'p1',
        name: 'Ana',
        rank: 1,
        tied: false,
        totalScore: 40,
        speedBonus: 0,
        timeTakenSeconds: 5,
        auto: false,
        answers: GOOD,
        categories: {} as never,
      },
    ]);

    newMatch(room, 'p1');

    expect(room.phase).toBe('lobby');
    expect(room.roundsPlayed).toBe(0);
    expect(standingsOf(room)).toEqual([]);
    expect(canSetRounds(room)).toBe(true);
  });
});

describe('the view a player is given', () => {
  it('never exposes another player answers while the round is running', () => {
    const room = roomWith(['Ana', 'Ben']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    submit(room, 'p1', GOOD, sec(5));

    const view = toView(room, 'p2', sec(6));
    expect(JSON.stringify(view)).not.toContain('Spoon');
    expect(view.players.find((p) => p.id === 'p1')?.hasSubmitted).toBe(true);
    expect(view.results).toBeNull();
  });

  it('sends the deadline and the server clock so the client never trusts its own', () => {
    const room = roomWith(['Ana']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    const view = toView(room, 'p1', sec(10));

    expect(view.round?.endsAt).toBe(new Date(sec(ROOM_RULES.roundSeconds)).toISOString());
    expect(view.round?.serverNow).toBe(new Date(sec(10)).toISOString());
  });
});

/** A judge that scores every answer valid, so the service can be tested without a model. */
const stubJudge: Judge = {
  async judge({ answers }) {
    const category = (word: string) => ({
      valid: word.trim().length > 0,
      bonusMatched: false,
      feedback: 'ok',
    });
    return {
      categories: {
        name: category(answers.name),
        place: category(answers.place),
        animal: category(answers.animal),
        thing: category(answers.thing),
      },
      overallFeedback: 'ok',
      judgedBy: 'heuristic',
    };
  },
};

function service() {
  let letter = 'S';
  return createRoomService({
    judge: stubJudge,
    nextPuzzle: async () => ({ letter, bonusChallenge: CHALLENGE }),
    now: () => Date.now(),
  });
}

/**
 * Two services over one store — what two replicas serving one room really are.
 *
 * The clock is shared and injected so a round can be pushed past its deadline
 * without waiting a minute for it.
 */
function replicas(count = 2) {
  const store = createMemoryRoomStore();
  let clock = T0;
  const judged: string[] = [];

  const countingJudge: Judge = {
    async judge(request) {
      judged.push(request.answers.name);
      return stubJudge.judge(request);
    },
  };

  const services = Array.from({ length: count }, () =>
    createRoomService({
      store,
      judge: countingJudge,
      nextPuzzle: async () => ({ letter: 'S', bonusChallenge: CHALLENGE }),
      now: () => clock,
    })
  );

  return {
    store,
    services,
    judged,
    advanceTo: (seconds: number) => {
      clock = sec(seconds);
    },
  };
}

describe('the room service end to end', () => {
  it('creates a room, admits a second player, races, and reveals a leaderboard', async () => {
    const rooms = service();

    const created = await rooms.create('host', 'Ana');
    expect(created.code).toMatch(/^[A-Z2-9]{4}$/);
    expect(created.youAreHost).toBe(true);

    const joined = await rooms.join(created.code, 'guest', 'Ben');
    expect(joined.players).toHaveLength(2);
    expect(joined.youAreHost).toBe(false);

    const started = await rooms.start(created.code, 'host');
    expect(started.phase).toBe('racing');
    expect(started.round?.letter).toBe('S');

    await rooms.submit(created.code, 'host', GOOD);
    const done = await rooms.submit(created.code, 'guest', GOOD);

    // Everyone submitted, so the round is judged without waiting for the clock.
    expect(done.phase).toBe('reveal');
    expect(done.results?.endedBy).toBe('all-submitted');
    expect(done.results?.rows).toHaveLength(2);
    expect(done.results?.rows[0].rank).toBe(1);
    expect(done.standings).toHaveLength(2);

    const lobby = await rooms.next(created.code, 'host');
    expect(lobby.phase).toBe('lobby');
    expect(lobby.roundsPlayed).toBe(1);
  });

  it('scores duplicate answers identically — no penalty for clashing', async () => {
    const rooms = service();
    const { code } = await rooms.create('a', 'Ana');
    await rooms.join(code, 'b', 'Ben');
    await rooms.start(code, 'a');

    await rooms.submit(code, 'a', GOOD);
    const view = await rooms.submit(code, 'b', GOOD);

    const scores = view.results!.rows.map((r) => r.totalScore);
    expect(new Set(scores).size).toBe(1);
  });

  it('refuses a room code that does not exist', async () => {
    const rooms = service();
    await expect(rooms.join('ZZZZ', 'p', 'P')).rejects.toThrow(RoomError);
  });

  it('refuses a non-host trying to start', async () => {
    const rooms = service();
    const { code } = await rooms.create('a', 'Ana');
    await rooms.join(code, 'b', 'Ben');
    await expect(rooms.start(code, 'b')).rejects.toThrow(/host/i);
  });

  it('plays exactly the number of rounds the host asked for, then closes the match', async () => {
    const rooms = service();
    const { code } = await rooms.create('a', 'Ana');

    const set = await rooms.setRounds(code, 'a', 1);
    expect(set.totalRounds).toBe(1);
    expect(set.canSetRounds).toBe(true);

    await rooms.start(code, 'a');
    const done = await rooms.submit(code, 'a', GOOD);

    expect(done.phase).toBe('reveal');
    expect(done.matchComplete).toBe(true);
    await expect(rooms.next(code, 'a')).rejects.toThrow(/match is over/i);

    const fresh = await rooms.newMatch(code, 'a');
    expect(fresh.phase).toBe('lobby');
    expect(fresh.roundsPlayed).toBe(0);
    expect(fresh.matchComplete).toBe(false);
    expect(fresh.canSetRounds).toBe(true);
    expect(fresh.standings).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * Several replicas, one room.
 *
 * This app runs at up to 5 replicas, so two players in one room are routinely
 * served by different processes. These tests are the reason the store deals in
 * versions at all: without them, the last writer silently erases whatever the
 * other replica had just recorded.
 * ------------------------------------------------------------------------- */

describe('a room shared between replicas', () => {
  it('refuses a write built on a read that has since gone stale', async () => {
    const store = createMemoryRoomStore();
    await store.create(createRoom('TEST', T0));

    const mine = await store.get('TEST');
    const theirs = await store.get('TEST');

    await store.put(theirs!);
    await expect(store.put(mine!)).rejects.toThrow(RoomVersionConflict);
  });

  it('hands out copies, so a room cannot be changed without saving it', async () => {
    const store = createMemoryRoomStore();
    await store.create(createRoom('TEST', T0));

    const stored = await store.get('TEST');
    stored!.room.phase = 'racing';

    expect((await store.get('TEST'))!.room.phase).toBe('lobby');
  });

  it('refuses to create a room code that is already taken', async () => {
    const store = createMemoryRoomStore();
    await store.create(createRoom('TAKEN', T0));

    await expect(store.create(createRoom('TAKEN', T0))).rejects.toThrow(RoomVersionConflict);
  });

  // ⚠️ The bug this whole design exists to prevent: one replica reads, another
  // writes, and the first saves a room built before that write ever happened.
  it('redoes a change that lost the race instead of erasing the winner', async () => {
    const { store, services } = replicas();
    const [a, b] = services;

    const { code } = await a.create('p1', 'Ana');

    // `a` is part-way through admitting Ben when Cal joins on `b`.
    let interrupted = false;
    const racing = {
      ...store,
      async put(stored: Parameters<typeof store.put>[0]) {
        if (!interrupted) {
          interrupted = true;
          await b.join(code, 'p3', 'Cal');
        }
        return store.put(stored);
      },
    };

    const interruptible = createRoomService({
      store: racing,
      judge: stubJudge,
      nextPuzzle: async () => ({ letter: 'S', bonusChallenge: CHALLENGE }),
      now: () => T0,
    });

    const view = await interruptible.join(code, 'p2', 'Ben');

    expect(interrupted).toBe(true);
    expect(view.players.map((p) => p.name).sort()).toEqual(['Ana', 'Ben', 'Cal']);
  });

  it('keeps both submissions when two players answer at the same moment', async () => {
    const { services, advanceTo } = replicas();
    const [a, b] = services;

    const { code } = await a.create('p1', 'Ana');
    await b.join(code, 'p2', 'Ben');
    await a.start(code, 'p1');

    advanceTo(10);
    await Promise.all([a.submit(code, 'p1', GOOD), b.submit(code, 'p2', GOOD)]);

    const view = await a.view(code, 'p1');
    expect(view.phase).toBe('reveal');
    expect(view.results?.rows).toHaveLength(2);
    expect(view.results?.rows.map((r) => r.answers.name)).toEqual(['Sam', 'Sam']);
  });

  /**
   * ⚠️ Judging is the one step that must happen exactly once. It adds a round to
   * the standings, so two replicas both doing it would score the round twice —
   * and unlike a lost write, that damage cannot be undone by the next poll.
   */
  it('judges a round once, however many replicas notice it is over', async () => {
    const { services, judged, advanceTo } = replicas(3);
    const [a, b, c] = services;

    const { code } = await a.create('p1', 'Ana');
    await b.join(code, 'p2', 'Ben');
    await a.start(code, 'p1');

    advanceTo(10);
    await a.submit(code, 'p1', GOOD);

    // The clock runs out, and every replica sees it on its next poll.
    advanceTo(ROOM_RULES.roundSeconds + ROOM_RULES.submitGraceSeconds + 1);
    await Promise.all([a.view(code, 'p1'), b.view(code, 'p2'), c.view(code, 'p1')]);

    const view = await a.view(code, 'p1');
    expect(view.phase).toBe('reveal');
    expect(view.results?.rows).toHaveLength(2);
    // One round each, not one per replica that happened to look.
    expect(view.standings.map((row) => row.roundsPlayed)).toEqual([1, 1]);
    expect(judged).toHaveLength(2);
  });

  it('lets another replica take over a judging claim that went stale', async () => {
    const { store, services, advanceTo } = replicas();
    const [a, b] = services;

    const { code } = await a.create('p1', 'Ana');
    await a.start(code, 'p1');

    advanceTo(10);
    await a.submit(code, 'p1', GOOD);

    // Rewind the room to a replica that claimed the judging and then died.
    const stored = await store.get(code);
    stored!.room.phase = 'judging';
    stored!.room.results = null;
    stored!.room.judgingSince = sec(10) - ROOM_RULES.judgingClaimSeconds * 1000 - 1000;
    await store.put(stored!);

    const view = await b.view(code, 'p1');
    expect(view.phase).toBe('reveal');
    expect(view.results?.rows).toHaveLength(1);
  });
});
