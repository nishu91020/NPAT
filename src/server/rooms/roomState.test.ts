import { describe, expect, it } from 'vitest';
import type { BonusChallenge, RoomView, UserAnswers } from '../../shared/contract';
import { createRoomService } from './service';
import { createMemoryRoomStore } from './memoryStore';
import {
  RoomError,
  authorize,
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
import { ROOM_RULES, RoomVersionConflict, type PlayerSeat, type Room } from './types';
import type { Judge } from '../referee';

const CHALLENGE: BonusChallenge = {
  id: 'test',
  title: 'Test',
  description: 'Test challenge',
  icon: 'Sparkles',
  ruleHint: 'test',
};

const GOOD: UserAnswers = { name: 'Sam', place: 'Spain', animal: 'Snake', thing: 'Spoon' };
const ROUND_TWO: UserAnswers = { name: 'Sonic', place: 'Sweden', animal: 'Seal', thing: 'Sword' };
const BLANK: UserAnswers = { name: '', place: '', animal: '', thing: '' };

const seatOf = (view: RoomView): PlayerSeat => ({
  playerId: view.youId,
  token: view.youToken!,
});

const T0 = 1_000_000;
const sec = (n: number) => T0 + n * 1000;

const tokenFor = (playerId: string) => `token-${playerId}`;

function roomWith(names: string[]) {
  const room = createRoom('TEST', T0);
  names.forEach((name, i) => join(room, `p${i + 1}`, name, T0, tokenFor(`p${i + 1}`)));
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

    leave(room, 'p2', sec(6));
    maybeEndRound(room, sec(7));

    expect(room.round?.endedBy).toBe('clock');
    expect(room.round?.submissions.p2.auto).toBe(true);
  });

  it('never reports a time longer than the round, however late the poll arrives', () => {
    const room = roomWith(['Ana', 'Ben']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    submit(room, 'p1', GOOD, sec(5));

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
    join(room, 'late', 'Late', sec(5), tokenFor('late'));
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
    join(room, 'p1', 'Ana', sec(3), tokenFor('p1'));

    expect(room.players).toHaveLength(1);
    expect(room.players[0].present).toBe(true);
    expect(room.players[0].isHost).toBe(true);
  });

  it('refuses a seat to anyone who cannot present its token', () => {

    const room = roomWith(['Ana']);
    leave(room, 'p1', sec(1));

    expect(() => join(room, 'p1', 'Impostor', sec(3), 'guessed')).toThrow(/taken/i);
    expect(room.players[0].name).toBe('Ana');
  });

  it('recognises a player by their token, and refuses one with the wrong one', () => {
    const room = roomWith(['Ana', 'Ben']);

    expect(authorize(room, { playerId: 'p1', token: tokenFor('p1') }).name).toBe('Ana');
    expect(() => authorize(room, { playerId: 'p1', token: tokenFor('p2') })).toThrow(/not in this room/i);
    expect(() => authorize(room, { playerId: 'p1', token: '' })).toThrow(/not in this room/i);
    expect(() => authorize(room, { playerId: 'ghost', token: tokenFor('ghost') })).toThrow(
      /not in this room/i
    );
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
    for (let i = 0; i < ROOM_RULES.maxPlayers; i++) join(room, `p${i}`, `P${i}`, T0, tokenFor(`p${i}`));
    expect(() => join(room, 'extra', 'Extra', T0, tokenFor('extra'))).toThrow(/full/i);
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
    join(room, 'late', 'Late', sec(5), tokenFor('late'));

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
    room.phase = 'reveal';

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

    expect(created.youToken).toBeTruthy();

    const joined = await rooms.join(created.code, 'guest', 'Ben');
    expect(joined.players).toHaveLength(2);
    expect(joined.youAreHost).toBe(false);

    const host = seatOf(created);
    const guest = seatOf(joined);

    const started = await rooms.start(created.code, host);
    expect(started.phase).toBe('racing');
    expect(started.round?.letter).toBe('S');

    await rooms.submit(created.code, host, GOOD);
    const done = await rooms.submit(created.code, guest, GOOD);

    expect(done.phase).toBe('reveal');
    expect(done.results?.endedBy).toBe('all-submitted');
    expect(done.results?.rows).toHaveLength(2);
    expect(done.results?.rows[0].rank).toBe(1);
    expect(done.standings).toHaveLength(2);

    const lobby = await rooms.next(created.code, host);
    expect(lobby.phase).toBe('lobby');
    expect(lobby.roundsPlayed).toBe(1);
  });

  it('scores duplicate answers identically — no penalty for clashing', async () => {
    const rooms = service();
    const created = await rooms.create('a', 'Ana');
    const joined = await rooms.join(created.code, 'b', 'Ben');
    await rooms.start(created.code, seatOf(created));

    await rooms.submit(created.code, seatOf(created), GOOD);
    const view = await rooms.submit(created.code, seatOf(joined), GOOD);

    const scores = view.results!.rows.map((r) => r.totalScore);
    expect(new Set(scores).size).toBe(1);
  });

  it('refuses a room code that does not exist', async () => {
    const rooms = service();
    await expect(rooms.join('ZZZZ', 'p', 'P')).rejects.toThrow(RoomError);
  });

  it('refuses a non-host trying to start', async () => {
    const rooms = service();
    const created = await rooms.create('a', 'Ana');
    const joined = await rooms.join(created.code, 'b', 'Ben');
    await expect(rooms.start(created.code, seatOf(joined))).rejects.toThrow(/host/i);
  });

  it('refuses every action to a caller holding somebody else\'s id', async () => {
    const rooms = service();
    const created = await rooms.create('a', 'Ana');
    const joined = await rooms.join(created.code, 'b', 'Ben');
    const code = created.code;

    const stolen: PlayerSeat = { playerId: 'a', token: joined.youToken! };
    const guessed: PlayerSeat = { playerId: 'a', token: 'not-the-token' };

    await expect(rooms.view(code, stolen)).rejects.toThrow(/not in this room/i);
    await expect(rooms.start(code, stolen)).rejects.toThrow(/not in this room/i);
    await expect(rooms.setRounds(code, guessed, 5)).rejects.toThrow(/not in this room/i);
    await expect(rooms.newMatch(code, guessed)).rejects.toThrow(/not in this room/i);
    await expect(rooms.next(code, guessed)).rejects.toThrow(/not in this room/i);
    await expect(rooms.submit(code, stolen, GOOD)).rejects.toThrow(/not in this room/i);
  });

  it('will not let one player submit for another, which would bury the real answers', async () => {
    const rooms = service();
    const created = await rooms.create('a', 'Ana');
    const joined = await rooms.join(created.code, 'b', 'Ben');
    const code = created.code;
    await rooms.start(code, seatOf(created));

    await expect(
      rooms.submit(code, { playerId: 'a', token: joined.youToken! }, BLANK)
    ).rejects.toThrow(/not in this room/i);

    await rooms.submit(code, seatOf(created), GOOD);
    const done = await rooms.submit(code, seatOf(joined), GOOD);

    const ana = done.results!.rows.find((row) => row.playerId === 'a');
    expect(ana?.answers).toEqual(GOOD);
    expect(ana?.totalScore).toBeGreaterThan(0);
  });

  it('will not let one player mark another absent', async () => {
    const rooms = service();
    const created = await rooms.create('a', 'Ana');
    const joined = await rooms.join(created.code, 'b', 'Ben');

    await rooms.leave(created.code, { playerId: 'a', token: joined.youToken! });

    const view = await rooms.view(created.code, seatOf(created));
    expect(view.players.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('draws no puzzle for a caller who was never allowed to start a round', async () => {

    let drawn = 0;
    const rooms = createRoomService({
      judge: stubJudge,
      nextPuzzle: async () => {
        drawn++;
        return { letter: 'S', bonusChallenge: CHALLENGE };
      },
      now: () => Date.now(),
    });

    const created = await rooms.create('a', 'Ana');
    const joined = await rooms.join(created.code, 'b', 'Ben');

    await expect(rooms.start(created.code, seatOf(joined))).rejects.toThrow(/host/i);
    await expect(
      rooms.start(created.code, { playerId: 'a', token: 'guessed' })
    ).rejects.toThrow(/not in this room/i);
    expect(drawn).toBe(0);

    await rooms.start(created.code, seatOf(created));
    expect(drawn).toBe(1);

    await expect(rooms.start(created.code, seatOf(created))).rejects.toThrow(/already running/i);
    expect(drawn).toBe(1);
  });

  it('does not save the room on every poll, which the judging has to write past', async () => {

    const store = createMemoryRoomStore();
    let clock = T0;
    let writes = 0;
    const counting = {
      ...store,
      async put(stored: Parameters<typeof store.put>[0]) {
        writes++;
        return store.put(stored);
      },
    };

    const rooms = createRoomService({
      store: counting,
      judge: stubJudge,
      nextPuzzle: async () => ({ letter: 'S', bonusChallenge: CHALLENGE }),
      now: () => clock,
    });

    const created = await rooms.create('p1', 'Ana');
    const host = seatOf(created);
    writes = 0;

    for (let i = 0; i < 4; i++) {
      clock = T0 + i * 250;
      await rooms.view(created.code, host);
    }
    expect(writes).toBe(0);

    clock = sec(6);
    await rooms.view(created.code, host);
    expect(writes).toBe(1);
    expect((await store.get(created.code))!.room.players[0].lastSeenAt).toBe(sec(6));
  });

  it('plays exactly the number of rounds the host asked for, then closes the match', async () => {
    const rooms = service();
    const created = await rooms.create('a', 'Ana');
    const host = seatOf(created);
    const code = created.code;

    const set = await rooms.setRounds(code, host, 1);
    expect(set.totalRounds).toBe(1);
    expect(set.canSetRounds).toBe(true);

    await rooms.start(code, host);
    const done = await rooms.submit(code, host, GOOD);

    expect(done.phase).toBe('reveal');
    expect(done.matchComplete).toBe(true);
    await expect(rooms.next(code, host)).rejects.toThrow(/match is over/i);

    const fresh = await rooms.newMatch(code, host);
    expect(fresh.phase).toBe('lobby');
    expect(fresh.roundsPlayed).toBe(0);
    expect(fresh.matchComplete).toBe(false);
    expect(fresh.canSetRounds).toBe(true);
    expect(fresh.standings).toEqual([]);
  });
});

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

  it('takes over a code held by a room that has already expired', async () => {
    const store = createMemoryRoomStore();
    let taken: string | null = null;

    const squatted = {
      ...store,
      async create(room: Room) {
        if (taken === null) {

          taken = room.code;
          await store.create(createRoom(room.code, T0));
          throw new RoomVersionConflict(room.code);
        }
        return store.create(room);
      },
    };

    const rooms = createRoomService({
      store: squatted,
      judge: stubJudge,
      nextPuzzle: async () => ({ letter: 'S', bonusChallenge: CHALLENGE }),
      now: () => sec(ROOM_RULES.emptyGraceSeconds + 60),
    });

    const view = await rooms.create('p1', 'Ana');

    expect(view.code).toBe(taken);
    expect(view.players.map((p) => p.name)).toEqual(['Ana']);
    expect((await store.get(view.code))!.room.players).toHaveLength(1);
  });

  it('leaves a live room alone and takes a different code instead', async () => {
    const store = createMemoryRoomStore();
    let squatted: string | null = null;

    const colliding = {
      ...store,
      async create(room: Room) {
        if (squatted === null) {

          squatted = room.code;
          const live = createRoom(room.code, T0);
          join(live, 'p1', 'Ana', T0, 'token-p1');
          await store.create(live);
          throw new RoomVersionConflict(room.code);
        }
        return store.create(room);
      },
    };

    const rooms = createRoomService({
      store: colliding,
      judge: stubJudge,
      nextPuzzle: async () => ({ letter: 'S', bonusChallenge: CHALLENGE }),
      now: () => T0,
    });

    const view = await rooms.create('p2', 'Ben');

    expect(view.code).not.toBe(squatted);
    expect((await store.get(squatted!))!.room.players.map((p) => p.name)).toEqual(['Ana']);
  });

  it('redoes a change that lost the race instead of erasing the winner', async () => {
    const { store, services } = replicas();
    const [a, b] = services;

    const { code } = await a.create('p1', 'Ana');

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

    const created = await a.create('p1', 'Ana');
    const code = created.code;
    const joined = await b.join(code, 'p2', 'Ben');
    await a.start(code, seatOf(created));

    advanceTo(10);
    await Promise.all([
      a.submit(code, seatOf(created), GOOD),
      b.submit(code, seatOf(joined), GOOD),
    ]);

    const view = await a.view(code, seatOf(created));
    expect(view.phase).toBe('reveal');
    expect(view.results?.rows).toHaveLength(2);
    expect(view.results?.rows.map((r) => r.answers.name)).toEqual(['Sam', 'Sam']);
  });

  it('judges a round once, however many replicas notice it is over', async () => {
    const { services, judged, advanceTo } = replicas(3);
    const [a, b, c] = services;

    const created = await a.create('p1', 'Ana');
    const code = created.code;
    const joined = await b.join(code, 'p2', 'Ben');
    await a.start(code, seatOf(created));

    advanceTo(10);
    await a.submit(code, seatOf(created), GOOD);

    advanceTo(ROOM_RULES.roundSeconds + ROOM_RULES.submitGraceSeconds + 1);
    await Promise.all([
      a.view(code, seatOf(created)),
      b.view(code, seatOf(joined)),
      c.view(code, seatOf(created)),
    ]);

    const view = await a.view(code, seatOf(created));
    expect(view.phase).toBe('reveal');
    expect(view.results?.rows).toHaveLength(2);

    expect(view.standings.map((row) => row.roundsPlayed)).toEqual([1, 1]);
    expect(judged).toHaveLength(2);
  });

  it('lets another replica take over a judging claim that went stale', async () => {
    const { store, services, advanceTo } = replicas();
    const [a, b] = services;

    const created = await a.create('p1', 'Ana');
    const code = created.code;
    await a.start(code, seatOf(created));

    advanceTo(10);
    await a.submit(code, seatOf(created), GOOD);

    const stored = await store.get(code);
    stored!.room.phase = 'judging';
    stored!.room.results = null;
    stored!.room.judgingSince = sec(10) - ROOM_RULES.judgingClaimSeconds * 1000 - 1000;
    stored!.room.judgingRound = 1;
    await store.put(stored!);

    const view = await b.view(code, seatOf(created));
    expect(view.phase).toBe('reveal');
    expect(view.results?.rows).toHaveLength(1);
  });

  it('drops the results of a claim that came back to a room which has moved on', async () => {
    const store = createMemoryRoomStore();
    let clock = T0;

    let releaseA: () => void = () => undefined;
    let releaseB: () => void = () => undefined;
    const hangA = new Promise<void>((resolve) => (releaseA = resolve));
    const hangB = new Promise<void>((resolve) => (releaseB = resolve));

    const hangingJudge = (wait: Promise<void>, onCall: number): Judge => {
      let calls = 0;
      return {
        async judge(request) {
          if (++calls === onCall) await wait;
          return stubJudge.judge(request);
        },
      };
    };

    const deps = {
      store,
      nextPuzzle: async () => ({ letter: 'S', bonusChallenge: CHALLENGE }),
      now: () => clock,
    };
    const a = createRoomService({ ...deps, judge: hangingJudge(hangA, 1) });
    const b = createRoomService({ ...deps, judge: hangingJudge(hangB, 2) });

    const created = await a.create('p1', 'Ana');
    const code = created.code;
    const host = seatOf(created);

    const settle = async (want: (room: Room) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const stored = await store.get(code);
        if (stored && want(stored.room)) return stored.room;
      }
      throw new Error('the room never reached the state this test needs');
    };

    await a.start(code, host);
    clock = sec(10);
    const stuckOnRoundOne = a.submit(code, host, GOOD);
    await settle((room) => room.judgingSince !== null && room.judgingRound === 1);

    clock = sec(10 + ROOM_RULES.judgingClaimSeconds + 1);
    const revealed = await b.view(code, host);
    expect(revealed.phase).toBe('reveal');

    await b.next(code, host);
    await b.start(code, host);
    clock = sec(80);
    const stuckOnRoundTwo = b.submit(code, host, ROUND_TWO);
    await settle((room) => room.judgingRound === 2);

    releaseA();
    await stuckOnRoundOne;

    releaseB();
    const final = await stuckOnRoundTwo;

    expect(final.phase).toBe('reveal');
    expect(final.results?.rows[0].answers.name).toBe(ROUND_TWO.name);
    expect(final.standings[0].roundsPlayed).toBe(2);
    expect((await store.get(code))!.room.roundsPlayed).toBe(2);
  });
});
