/*
 * PROTOTYPE — throwaway. Not production code. Not imported by the app.
 *
 * The room state machine for a LIVE SYNCHRONISED RACE (round shape B), extracted
 * into a plain module so it can be driven both by room-state.html (a human
 * clicking) and by room-state.test.js (node --test, to prove the machine does
 * what the HTML claims it does).
 *
 * Judging here is FAKE and deterministic — a real round goes to an LLM. The
 * scoring constants, however, are copied verbatim from src/server/referee/scoring.ts
 * so the numbers on screen are the real ones.
 */

// Copied from src/server/referee/scoring.ts — keep in sync by hand; this is a prototype.
const SCORING = {
  validAnswer: 10,
  validAnswerWithBonus: 15,
  invalidAnswer: 0,
  speedTiers: [
    { maxSeconds: 20, bonus: 20 },
    { maxSeconds: 35, bonus: 10 },
    { maxSeconds: 50, bonus: 5 },
  ],
  noSpeedBonus: 0,
};

const CATEGORY_KEYS = ['name', 'place', 'animal', 'thing'];
const ROUND_SECONDS = 60;

/**
 * ⚠️ FOUND BY THIS PROTOTYPE. A room used to close the instant its last player
 * left — which meant a solo host **refreshing the page** destroyed their own room
 * before the browser could reconnect. Rooms therefore empty into a grace period
 * and only close if nobody comes back.
 *
 * This also matters because the app scales to zero: there is no reliable background
 * sweeper, so closing has to be driven by the clock of whoever is still around.
 */
const EMPTY_ROOM_GRACE_SECONDS = 120;

/**
 * SETTLED (user, this session): duplicate answers do NOT score less. Every player is
 * scored exactly as a solo round is scored today, and the leaderboard ranks those
 * scores. Kept as a flag only so the reveal can show "3 players wrote Sam" as a
 * talking point — it has zero effect on points.
 */
const DUPLICATE_RULE = 'no-penalty';

function speedBonusFor(seconds) {
  const tier = SCORING.speedTiers.find((t) => seconds <= t.maxSeconds);
  return tier ? tier.bonus : SCORING.noSpeedBonus;
}

function createRoom({ code = 'PLAY', letter = 'S', now = 0 } = {}) {
  return {
    code,
    letter,
    phase: 'lobby', // lobby | racing | judging | reveal
    players: [], // { id, name, isHost, joinedAt, present }
    round: null, // { number, startedAt, deadline, submissions: {}, endedBy }
    roundsPlayed: 0,
    results: null,
    standings: {}, // playerId -> running session totals
    now,
    log: [],
    closed: false,
    emptySince: null,
  };
}

function note(room, message) {
  room.log.push({ at: room.now, phase: room.phase, message });
  return room;
}

function player(room, id) {
  return room.players.find((p) => p.id === id);
}

function presentPlayers(room) {
  return room.players.filter((p) => p.present);
}

// --- actions ---------------------------------------------------------------

function join(room, id, name) {
  if (room.closed) return note(room, `${name} tried to join a closed room — refused.`);

  room.emptySince = null;

  const existing = player(room, id);
  if (existing) {
    // Identity across a refresh: the same client id reclaims its seat rather
    // than appearing as a second player. This is ticket 04's question, made concrete.
    const wasHost = existing.isHost;
    existing.present = true;
    // A room that emptied and came back needs a host again.
    if (!room.players.some((p) => p.present && p.isHost)) existing.isHost = true;
    return note(
      room,
      `${existing.name} reconnected and reclaimed their seat${
        existing.isHost && !wasHost ? ' (and is host again)' : ''
      }.`
    );
  }

  const isHost = room.players.every((p) => !p.present);
  room.players.push({ id, name, isHost, joinedAt: room.now, present: true });

  if (room.phase === 'racing') {
    // A late joiner does NOT get dropped into a race already in progress —
    // they would be playing a shorter clock than everyone else.
    return note(room, `${name} joined mid-round; waiting out this round in the lobby.`);
  }
  return note(room, `${name} joined${isHost ? ' (host)' : ''}.`);
}

function leave(room, id) {
  const p = player(room, id);
  if (!p) return room;
  p.present = false;
  note(room, `${p.name} left.`);

  if (presentPlayers(room).length === 0) {
    // Not closed yet — a refresh looks exactly like this. See EMPTY_ROOM_GRACE_SECONDS.
    room.emptySince = room.now;
    return note(room, `Room is empty; closing in ${EMPTY_ROOM_GRACE_SECONDS}s unless someone returns.`);
  }

  if (p.isHost) {
    // Host migration: the longest-present player inherits, so the room is never
    // stuck waiting for someone who has gone.
    p.isHost = false;
    const heir = presentPlayers(room).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    heir.isHost = true;
    note(room, `Host left — ${heir.name} is now host.`);
  }

  // A departure can be the thing that completes the round.
  if (room.phase === 'racing') maybeEndRound(room);
  return room;
}

function startRound(room, byId) {
  if (room.phase !== 'lobby') return note(room, 'Ignored: a round is already running.');
  const p = player(room, byId);
  if (!p || !p.isHost) return note(room, 'Ignored: only the host starts a round.');
  if (presentPlayers(room).length < 1) return note(room, 'Ignored: nobody here.');

  room.phase = 'racing';
  room.roundsPlayed += 1;
  room.round = {
    number: room.roundsPlayed,
    startedAt: room.now,
    deadline: room.now + ROUND_SECONDS,
    // Everyone present when the host started is in this round. Late joiners are not.
    racers: presentPlayers(room).map((x) => x.id),
    submissions: {},
    endedBy: null,
  };
  return note(room, `Round ${room.round.number} started — letter ${room.letter}, ${ROUND_SECONDS}s.`);
}

function submit(room, id, answers) {
  if (room.phase !== 'racing') return note(room, 'Ignored: no round running.');
  if (!room.round.racers.includes(id)) return note(room, 'Ignored: not in this round.');
  if (room.round.submissions[id]) return note(room, 'Ignored: already submitted (idempotent).');

  room.round.submissions[id] = {
    answers,
    // The SERVER measures this, from its own round start. The browser never reports it.
    timeTakenSeconds: Math.max(1, room.now - room.round.startedAt),
    auto: false,
  };
  note(room, `${player(room, id).name} submitted after ${room.now - room.round.startedAt}s.`);
  maybeEndRound(room);
  return room;
}

/** Advance the clock. Returns the room; ends the round if the deadline passes. */
function tick(room, seconds) {
  room.now += seconds;

  if (room.emptySince !== null && room.now - room.emptySince >= EMPTY_ROOM_GRACE_SECONDS) {
    room.closed = true;
    room.emptySince = null;
    return note(room, 'Nobody came back — room closed.');
  }

  if (room.phase === 'racing' && room.now >= room.round.deadline) {
    room.now = room.round.deadline;
    endRound(room, 'clock');
  }
  return room;
}

function maybeEndRound(room) {
  const stillRacing = room.round.racers.filter(
    (id) => player(room, id).present && !room.round.submissions[id]
  );
  if (stillRacing.length === 0) endRound(room, 'all-submitted');
  return room;
}

function endRound(room, endedBy) {
  room.round.endedBy = endedBy;

  // Anyone who never submitted has whatever they had typed taken as-is.
  for (const id of room.round.racers) {
    if (!room.round.submissions[id]) {
      room.round.submissions[id] = {
        answers: { name: '', place: '', animal: '', thing: '' },
        timeTakenSeconds: ROUND_SECONDS,
        auto: true,
      };
    }
  }

  room.phase = 'judging';
  note(room, `Round ended by ${endedBy}. Judging ${room.round.racers.length} players…`);
  return room;
}

/** Judging completes (in the real thing: N LLM calls). */
function judged(room) {
  if (room.phase !== 'judging') return note(room, 'Ignored: not judging.');
  room.results = score(room);
  accumulate(room, room.results);
  room.phase = 'reveal';
  return note(room, 'Reveal.');
}

/**
 * A room is a session of many rounds, so a round leaderboard is not the whole
 * story — the session standings are what people actually argue about. Same
 * ranking rule, applied to the running totals.
 */
function accumulate(room, results) {
  for (const row of results.rows) {
    const entry = (room.standings[row.id] = room.standings[row.id] || {
      id: row.id,
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

function standingsTable(room) {
  return rank(Object.values(room.standings));
}

function backToLobby(room) {
  if (room.phase !== 'reveal') return note(room, 'Ignored: not at reveal.');
  room.phase = 'lobby';
  room.round = null;
  room.results = null;
  return note(room, 'Back to the lobby. Host can start another round.');
}

// --- scoring ---------------------------------------------------------------

/** FAKE judge: valid if it starts with the letter; "bonus" stands in for a real rule. */
function fakeJudge(answer, letter) {
  const word = (answer || '').trim();
  if (word.length < 2) return { valid: false, bonusMatched: false };
  if (word[0].toUpperCase() !== letter.toUpperCase()) return { valid: false, bonusMatched: false };
  return { valid: true, bonusMatched: word.length >= 7 };
}

function score(room) {
  const { submissions, racers } = room.round;

  // Counted for the reveal only — "3 players wrote Sam" is a talking point.
  // SETTLED: it does not affect anybody's points.
  const duplicates = {};
  for (const key of CATEGORY_KEYS) {
    const counts = {};
    for (const id of racers) {
      const word = (submissions[id].answers[key] || '').trim().toLowerCase();
      if (!word) continue;
      counts[word] = (counts[word] || 0) + 1;
    }
    duplicates[key] = counts;
  }

  const rows = racers.map((id) => {
    const sub = submissions[id];
    const categories = {};
    let base = 0;
    let validCount = 0;

    for (const key of CATEGORY_KEYS) {
      const word = (sub.answers[key] || '').trim();
      const verdict = fakeJudge(word, room.letter);

      // Identical to the solo game. No multiplayer term enters this calculation.
      const points = verdict.valid
        ? verdict.bonusMatched
          ? SCORING.validAnswerWithBonus
          : SCORING.validAnswer
        : SCORING.invalidAnswer;

      const sharedWith = word ? (duplicates[key][word.toLowerCase()] || 0) - 1 : 0;

      if (verdict.valid) validCount += 1;
      base += points;
      categories[key] = { word, ...verdict, points, sharedWith };
    }

    // Unchanged from solo: the speed bonus requires all four to be valid.
    // Every racer started at the same instant, so comparing elapsed times is fair.
    const speedBonus =
      validCount === CATEGORY_KEYS.length ? speedBonusFor(sub.timeTakenSeconds) : SCORING.noSpeedBonus;

    return {
      id,
      name: player(room, id).name,
      categories,
      validCount,
      timeTakenSeconds: sub.timeTakenSeconds,
      auto: sub.auto,
      speedBonus,
      totalScore: base + speedBonus,
    };
  });

  return { rows: rank(rows), endedBy: room.round.endedBy, duplicateRule: DUPLICATE_RULE };
}

/**
 * The leaderboard: rank by the score as calculated today, fastest first on a tie.
 *
 * Standard competition ranking — two players genuinely level share a rank and the
 * next rank is skipped (1, 2, 2, 4). Time is the tiebreak because in a race the
 * player who got there first is ahead; only players level on BOTH share a rank.
 */
function rank(rows) {
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
      previous &&
      previous.totalScore === row.totalScore &&
      previous.timeTakenSeconds === row.timeTakenSeconds;

    lastRank = level ? lastRank : index + 1;
    return { ...row, rank: lastRank, tied: Boolean(level) };
  });
}

const API = {
  SCORING,
  CATEGORY_KEYS,
  ROUND_SECONDS,
  EMPTY_ROOM_GRACE_SECONDS,
  DUPLICATE_RULE,
  createRoom,
  join,
  leave,
  startRound,
  submit,
  tick,
  judged,
  backToLobby,
  score,
  rank,
  standingsTable,
  speedBonusFor,
  presentPlayers,
  player,
};

// Classic script on purpose: the browser loads this with a plain <script src> from
// file://, and room-state.test.cjs evaluates this same file in a vm sandbox — so
// there is exactly one copy of the state machine.
if (typeof globalThis !== 'undefined') globalThis.RoomProto = API;
