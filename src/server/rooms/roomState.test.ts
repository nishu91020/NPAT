import { describe, expect, it } from 'vitest';
import type { BonusChallenge, UserAnswers } from '../../shared/contract';
import { createRoomService } from './service';
import {
  RoomError,
  createRoom,
  generateRoomCode,
  join,
  leave,
  maybeEndRound,
  rankRows,
  reapAbsent,
  startRound,
  submit,
  isExpired,
  toView,
  touch,
} from './roomState';
import { ROOM_RULES } from './types';
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

    maybeEndRound(room, sec(ROOM_RULES.roundSeconds + 1));

    expect(room.phase).toBe('judging');
    expect(room.round?.endedBy).toBe('clock');
    expect(room.round?.submissions.p2.auto).toBe(true);
  });

  it('does not wait for a player who has gone', () => {
    const room = roomWith(['Ana', 'Ben']);
    startRound(room, 'p1', 'S', CHALLENGE, T0);
    submit(room, 'p1', GOOD, sec(5));

    leave(room, 'p2', sec(6));
    maybeEndRound(room, sec(7));

    expect(room.phase).toBe('judging');
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
});
