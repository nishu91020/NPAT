/*
 * PROTOTYPE tests — run with: node --test .scratch/multiplayer-rooms/prototype/
 *
 * These are not part of `npm test` and are not production tests. They exist so the
 * claims made by room-state.html are checked rather than asserted, and so the two
 * rules settled by the user are pinned:
 *   1. A round ends when everyone has submitted OR the timer expires.
 *   2. Duplicate answers do NOT score less.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// One source of truth: evaluate the same file the browser loads.
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'room-state.js'), 'utf8'), sandbox);
const R = sandbox.RoomProto;

function roomWith(names) {
  const room = R.createRoom({ letter: 'S' });
  names.forEach((n, i) => R.join(room, `p${i + 1}`, n));
  return room;
}

const GOOD = { name: 'Sam', place: 'Spain', animal: 'Snake', thing: 'Spoon' };

test('a round ends as soon as every racer has submitted', () => {
  const room = roomWith(['Ana', 'Ben']);
  R.startRound(room, 'p1');
  R.tick(room, 10);
  R.submit(room, 'p1', GOOD);
  assert.strictEqual(room.phase, 'racing', 'one submission must not end the round');

  R.submit(room, 'p2', GOOD);
  assert.strictEqual(room.phase, 'judging');
  assert.strictEqual(room.round.endedBy, 'all-submitted');
  assert.ok(room.now < room.round.deadline, 'ended before the clock, not on it');
});

test('a round ends when the timer expires even if someone never submits', () => {
  const room = roomWith(['Ana', 'Ben']);
  R.startRound(room, 'p1');
  R.tick(room, 12);
  R.submit(room, 'p1', GOOD);

  R.tick(room, 100); // well past the deadline
  assert.strictEqual(room.phase, 'judging');
  assert.strictEqual(room.round.endedBy, 'clock');
  assert.strictEqual(room.now, room.round.deadline, 'clock stops at the deadline, not beyond');
  assert.ok(room.round.submissions.p2.auto, 'the silent player is auto-submitted');
});

test('duplicate answers do not score less — identical rounds score identically', () => {
  const room = roomWith(['Ana', 'Ben', 'Cal']);
  R.startRound(room, 'p1');
  R.tick(room, 10);
  // All three write exactly the same four words.
  R.submit(room, 'p1', GOOD);
  R.submit(room, 'p2', GOOD);
  R.submit(room, 'p3', GOOD);
  R.judged(room);

  const scores = room.results.rows.map((r) => r.totalScore);
  assert.strictEqual(new Set(scores).size, 1, 'no duplicate penalty — all three level');
  assert.ok(scores[0] > 0);

  // And the reveal still knows they clashed, for interest only.
  const ana = room.results.rows.find((r) => r.name === 'Ana');
  assert.strictEqual(ana.categories.name.sharedWith, 2);
  assert.strictEqual(ana.categories.name.points, R.SCORING.validAnswer);
});

test('a solo-identical round scores identically in a room', () => {
  // The point of "duplicates do not score less": multiplayer adds no scoring term.
  const room = roomWith(['Ana', 'Ben']);
  R.startRound(room, 'p1');
  R.tick(room, 15);
  R.submit(room, 'p1', GOOD);
  R.submit(room, 'p2', { name: 'Sara', place: 'Sydney', animal: 'Swan', thing: 'Sofa' });
  R.judged(room);

  const ana = room.results.rows.find((r) => r.name === 'Ana');
  // 4 valid answers, none >= 7 chars, at 15s => 4*10 + 20 speed bonus.
  assert.strictEqual(ana.speedBonus, R.speedBonusFor(15));
  assert.strictEqual(ana.totalScore, 4 * R.SCORING.validAnswer + R.speedBonusFor(15));
});

test('the leaderboard ranks by score, breaking ties on time', () => {
  const room = roomWith(['Slow', 'Fast']);
  R.startRound(room, 'p1');
  R.tick(room, 5);
  R.submit(room, 'p2', GOOD); // Fast, 5s
  R.tick(room, 25);
  R.submit(room, 'p1', GOOD); // Slow, 30s — same answers, so same base score
  R.judged(room);

  const [first, second] = room.results.rows;
  assert.strictEqual(first.name, 'Fast');
  assert.strictEqual(first.rank, 1);
  assert.strictEqual(second.rank, 2);
  assert.ok(first.totalScore > second.totalScore, 'the speed bonus separates them');
});

test('players genuinely level share a rank and the next rank is skipped', () => {
  const rows = [
    { name: 'A', totalScore: 50, timeTakenSeconds: 20 },
    { name: 'B', totalScore: 50, timeTakenSeconds: 20 },
    { name: 'C', totalScore: 10, timeTakenSeconds: 40 },
  ];
  const ranked = R.rank(rows);
  assert.strictEqual(ranked.map((r) => r.rank).join(','), '1,1,3');
  assert.strictEqual(ranked[1].tied, true);
});

test('the speed bonus still requires all four answers to be valid', () => {
  const room = roomWith(['Ana']);
  R.startRound(room, 'p1');
  R.tick(room, 3);
  R.submit(room, 'p1', { name: 'Sam', place: 'Spain', animal: 'Snake', thing: 'Xylophone' });
  R.judged(room);
  assert.strictEqual(room.results.rows[0].speedBonus, 0, 'one wrong answer forfeits it');
});

test('a late joiner sits out the round in progress', () => {
  const room = roomWith(['Ana', 'Ben']);
  R.startRound(room, 'p1');
  R.join(room, 'p9', 'Late');
  assert.ok(!room.round.racers.includes('p9'));

  R.submit(room, 'p1', GOOD);
  R.submit(room, 'p2', GOOD);
  assert.strictEqual(room.phase, 'judging', 'the late joiner must not block the round');

  R.judged(room);
  R.backToLobby(room);
  R.startRound(room, 'p1');
  assert.ok(room.round.racers.includes('p9'), 'and plays the next round');
});

test('a refresh reclaims the same seat rather than creating a second player', () => {
  const room = roomWith(['Ana']);
  R.leave(room, 'p1'); // looks identical to a page refresh
  assert.strictEqual(room.closed, false, 'the room must survive long enough to come back to');

  R.tick(room, 5);
  R.join(room, 'p1', 'Ana');
  assert.strictEqual(room.players.length, 1);
  assert.strictEqual(R.player(room, 'p1').present, true);
  assert.strictEqual(R.player(room, 'p1').isHost, true, 'and is host again');
});

test('an empty room closes only after the grace period', () => {
  const room = roomWith(['Ana']);
  R.leave(room, 'p1');
  R.tick(room, R.EMPTY_ROOM_GRACE_SECONDS - 1);
  assert.strictEqual(room.closed, false);
  R.tick(room, 2);
  assert.strictEqual(room.closed, true);
  R.join(room, 'p2', 'Ben');
  assert.strictEqual(R.presentPlayers(room).length, 0, 'a closed room refuses joins');
});

test('the host leaving mid-round hands over and does not stall the round', () => {
  const room = roomWith(['Ana', 'Ben']);
  R.startRound(room, 'p1');
  R.tick(room, 8);
  R.submit(room, 'p2', GOOD);
  R.leave(room, 'p1'); // host walks out; Ben is the only racer left and has submitted

  assert.strictEqual(R.player(room, 'p2').isHost, true, 'host migrates');
  assert.strictEqual(room.phase, 'judging', 'a departure can complete the round');
});

test('the last player leaving starts the closing clock but does not close yet', () => {
  const room = roomWith(['Ana']);
  R.leave(room, 'p1');
  assert.strictEqual(room.closed, false);
  assert.strictEqual(room.emptySince, room.now);
});

test('session standings accumulate across rounds and count wins', () => {
  const room = roomWith(['Ana', 'Ben']);

  for (const round of [1, 2]) {
    R.startRound(room, 'p1');
    R.tick(room, 5);
    R.submit(room, 'p1', GOOD); // Ana always fast
    R.tick(room, 30);
    R.submit(room, 'p2', GOOD); // Ben always slow
    R.judged(room);
    R.backToLobby(room);
    assert.strictEqual(room.roundsPlayed, round);
  }

  const table = R.standingsTable(room);
  assert.strictEqual(table[0].name, 'Ana');
  assert.strictEqual(table[0].wins, 2);
  assert.strictEqual(table[0].roundsPlayed, 2);
  assert.ok(table[0].totalScore > table[1].totalScore);
});

test('submitting twice is ignored, so a retry cannot score twice', () => {
  const room = roomWith(['Ana', 'Ben']);
  R.startRound(room, 'p1');
  R.tick(room, 5);
  R.submit(room, 'p1', GOOD);
  const first = room.round.submissions.p1.timeTakenSeconds;
  R.tick(room, 10);
  R.submit(room, 'p1', { name: 'Sxx', place: '', animal: '', thing: '' });
  assert.strictEqual(room.round.submissions.p1.timeTakenSeconds, first);
  assert.strictEqual(room.round.submissions.p1.answers.name, 'Sam');
});

test('only the host can start a round', () => {
  const room = roomWith(['Ana', 'Ben']);
  R.startRound(room, 'p2');
  assert.strictEqual(room.phase, 'lobby');
  R.startRound(room, 'p1');
  assert.strictEqual(room.phase, 'racing');
});
