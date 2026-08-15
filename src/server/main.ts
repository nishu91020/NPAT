// MUST be first: the OpenTelemetry instrumentations patch `http` when they
// load, so anything imported before this is never instrumented.
import { flushTelemetry, telemetryStarted } from './telemetry/init';

import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { getDailyPuzzleData, getRandomPuzzleData } from '../shared/puzzle';
import { readAnswers } from './answers';
import {
  createAzureBonusAdjudicator,
  createAzureJudge,
  evaluateRound,
  heuristicJudge,
  unscoreableCategories,
  withFallback,
  type BonusAdjudicator,
  type Judge,
} from './referee';
import {
  cachedPerDate,
  createAzureBonusSource,
  createBlobStore,
  createRecentAvoidingPicker,
  deterministicSourceForDate,
  nullStore,
  randomBuiltinSource,
  ruleFamilyForDate,
  withBonusFallback,
  type BonusChallengeSource,
  type DailyChallengeStore,
} from './bonus';
import {
  createAzureClient,
  describeIncompleteConfig,
  resolveAzureConfig,
  type AzureClient,
} from './azure';
import { RoomError, createBlobRoomStore, createMemoryRoomStore, createRoomService, type RoomService, type RoomStore } from './rooms';

import {
  createAzureMonitorTelemetry,
  noopTelemetry,
  type Telemetry,
} from './telemetry';

// Load environment variables for server runtime.
dotenv.config({ path: '.env' });
dotenv.config();

const app = express();
// Container platforms inject the port; 3000 is the local default.
const PORT = Number(process.env.PORT) || 3000;

// Answers are four short words. A generous ceiling that still refuses junk.
app.use(express.json({ limit: '64kb' }));

/** Used only when a caller omits the field; the app always sends a real value. */
const DEFAULT_TIME_TAKEN_SECONDS = 40;

/**
 * Resolves Microsoft Foundry configuration. A partial configuration is fatal:
 * silently degrading on a typo means paying for AI judging that never happens.
 */
function createAzureClientOrExit(): AzureClient | null {
  const config = resolveAzureConfig(process.env);

  if (config.kind === 'incomplete') {
    console.error(describeIncompleteConfig(config.missing));
    process.exit(1);
  }

  if (config.kind === 'unconfigured') return null;

  return createAzureClient(config);
}

const azure = createAzureClientOrExit();

if (azure) {
  console.log('Microsoft Foundry configured; judge deployment:', azure.judgeDeployment);
} else {
  console.log('Microsoft Foundry not configured; running on the heuristic judge.');
}

// The heuristic backs the AI judge, covering both "not configured" and
// "the call failed".
const judge: Judge = azure
  ? withFallback(createAzureJudge(azure.client, azure.judgeDeployment), heuristicJudge)
  : heuristicJudge;

/**
 * Settles a round's bonus rule for every player at once, so a rule the model has
 * to interpret is interpreted the same way for all of them. Only rooms use it —
 * solo play has nobody to be inconsistent with — and it is optional, because a
 * heuristic-judged deployment has no model to ask.
 */
const bonusAdjudicator: BonusAdjudicator | undefined = azure
  ? createAzureBonusAdjudicator(azure.client, azure.judgeDeployment)
  : undefined;

/**
 * Two AI sources, differing only in how each chooses its rule family.
 *
 * The daily one rotates by date so no two consecutive days share a family;
 * practice draws at random but skips whatever it has served recently. Sharing
 * one source would put both back on an unconstrained random draw.
 */
const dailyAiSourceFor = azure
  ? (dateStr: string) =>
      createAzureBonusSource(azure.client, azure.bonusDeployment, () => ruleFamilyForDate(dateStr))
  : null;

const practiceAiSource: BonusChallengeSource | null = azure
  ? createAzureBonusSource(azure.client, azure.bonusDeployment, createRecentAvoidingPicker())
  : null;

const hasAiBonusSource = Boolean(azure);

/**
 * Shared store for the daily challenge, so every replica serves the same one.
 * Unset means single-replica behaviour: the in-process cache alone.
 *
 * Accepts either a blob endpoint (production, authenticated with Entra ID) or
 * a connection string (Azurite locally, via UseDevelopmentStorage=true).
 */
function createDailyChallengeStore(): DailyChallengeStore {
  const target = process.env.DAILY_CHALLENGE_STORAGE?.trim();
  if (!target) return nullStore;

  console.log('Daily challenge store enabled.');
  return createBlobStore(target);
}

const dailyChallengeStore = createDailyChallengeStore();

/**
 * Telemetry is optional. Keyed off whether instrumentation actually started,
 * not merely whether it was configured — a connection string the exporter
 * rejected leaves nothing to record into.
 */
const telemetry: Telemetry = telemetryStarted ? createAzureMonitorTelemetry() : noopTelemetry;

// One generation per date, shared by every player, with the deterministic
// challenge as the fallback.
const dailyBonus = cachedPerDate(
  (dateStr) =>
    dailyAiSourceFor
      ? withBonusFallback(dailyAiSourceFor(dateStr), deterministicSourceForDate(dateStr))
      : deterministicSourceForDate(dateStr),
  {
    store: dailyChallengeStore,
    onServed: (origin, dateStr) => telemetry.dailyChallengeServed({ origin, dateStr }),
  }
);

const practiceBonus: BonusChallengeSource = practiceAiSource
  ? withBonusFallback(practiceAiSource, randomBuiltinSource)
  : randomBuiltinSource;

app.get('/api/health', (req, res) => {
  // `rooms` is reported because it is a deployment decision, not a code one: it
  // says whether this replica can serve rooms and whether they are shared.
  res.json({ status: 'ok', time: new Date().toISOString(), rooms: roomsMode });
});

app.get('/api/daily-challenge', async (req, res) => {
  const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0];
  const basePuzzle = getDailyPuzzleData(dateStr);
  const bonusChallenge = await dailyBonus.forDate(dateStr, basePuzzle.letter);

  res.json({ ...basePuzzle, bonusChallenge, isRealtimeBonus: hasAiBonusSource });
});

app.get('/api/practice-challenge', async (req, res) => {
  const excludeLetter = req.query.exclude as string;
  const basePuzzle = getRandomPuzzleData(excludeLetter);
  const bonusChallenge = await practiceBonus.next(basePuzzle.letter);

  res.json({ ...basePuzzle, bonusChallenge, isRealtimeBonus: hasAiBonusSource });
});

app.post('/api/generate-bonus', async (req, res) => {
  const bonusChallenge = await practiceBonus.next(req.body?.letter || 'S');
  res.json(bonusChallenge);
});

app.post('/api/validate', async (req, res) => {
  const { letter, answers, bonusChallenge, timeTakenSeconds } = req.body ?? {};

  // The letter is compared against every answer, so it is held to the same bar:
  // a non-string got as far as the referee before failing.
  if (typeof letter !== 'string' || !letter.trim()) {
    return res.status(400).json({ error: 'Missing letter' });
  }

  const parsed = readAnswers(answers);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  const started = Date.now();
  let evaluation;

  try {
    evaluation = await evaluateRound(
      {
        letter,
        answers: parsed.answers,
        bonusChallenge,
        timeTakenSeconds:
          typeof timeTakenSeconds === 'number' ? timeTakenSeconds : DEFAULT_TIME_TAKEN_SECONDS,
      },
      judge
    );
  } catch (err) {
    console.error('Round evaluation failed:', err);
    telemetry.failure('validate', err);
    return res.status(500).json({ error: 'Could not evaluate this round' });
  }

  res.json(evaluation);

  // Recorded after the response and outside the try, so nothing about measuring
  // a round can turn a successful one into a failure.
  telemetry.roundJudged({
    judgedBy: evaluation.judgedBy,
    durationMs: Date.now() - started,
    totalScore: evaluation.totalScore,
    filteredCategories: unscoreableCategories(evaluation.categories),
  });
});

/* ---------------------------------------------------------------------------
 * Rooms — playing the same letter against other people.
 *
 * A room plays its OWN random letter, never the daily one, and its results never
 * touch the streak or the saved stats. That keeps the daily puzzle exactly as it
 * is: one letter a day, played once, with nothing about rooms able to corrupt it.
 * ------------------------------------------------------------------------- */

/**
 * Where rooms live — and whether they are offered at all.
 *
 * ⚠️ A room is shared state with a lifetime, which makes it the one feature this
 * app cannot serve from process memory by default. It runs at up to 5 replicas
 * and scales to zero, so an in-memory room is served differently to each player
 * and erased the moment the app goes idle. Rather than let a deployment discover
 * that in front of players, the endpoints are only mounted when the environment
 * has answered the question:
 *
 * - `ROOM_STORAGE` — a blob endpoint (Entra ID) or an Azurite connection string.
 *   Shared, survives a restart, correct at any replica count.
 * - `ROOMS_SINGLE_REPLICA=true` — an explicit promise that this deployment runs
 *   one replica and accepts losing rooms on restart.
 * - neither, in production — rooms are disabled and say so, rather than quietly
 *   handing two players two different rooms.
 *
 * Development is one process by definition, so it needs no such declaration.
 */
function createRoomStore(): { store: RoomStore; mode: 'shared' | 'single-replica' } | null {
  const target = process.env.ROOM_STORAGE?.trim();
  if (target) return { store: createBlobRoomStore(target), mode: 'shared' };

  if (process.env.ROOMS_SINGLE_REPLICA === 'true') {
    console.warn(
      'Rooms are in-memory: ROOMS_SINGLE_REPLICA is set. Rooms are lost on restart and are ' +
        'only correct while this deployment runs exactly one replica. Set ROOM_STORAGE to share them.'
    );
    return { store: createMemoryRoomStore(), mode: 'single-replica' };
  }

  if (process.env.NODE_ENV === 'production') return null;
  return { store: createMemoryRoomStore(), mode: 'single-replica' };
}

const roomStore = createRoomStore();
const roomsMode = roomStore?.mode ?? 'disabled';

if (roomStore) console.log(`Rooms enabled (${roomStore.mode}).`);
else console.warn('Rooms are DISABLED: set ROOM_STORAGE, or ROOMS_SINGLE_REPLICA=true to accept in-memory rooms.');

const rooms = roomStore
  ? createRoomService({
      store: roomStore.store,
      judge,
      bonusAdjudicator,
      // Each round draws a fresh letter, skipping the one just played.
      nextPuzzle: async (excludeLetter) => {
        const puzzle = getRandomPuzzleData(excludeLetter);
        const bonusChallenge = await practiceBonus.next(puzzle.letter);
        return { letter: puzzle.letter, bonusChallenge };
      },
    })
  : null;

/** The room service, or a 503 that explains itself. Never an unhandled null. */
function roomService(): RoomService {
  if (!rooms) {
    throw new RoomError('Rooms are not enabled on this deployment.', 503);
  }
  return rooms;
}

/** Rejects junk before it reaches the room service. */
function readIdentity(req: express.Request): { playerId: string; name: string } {
  const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId.trim() : '';
  const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

  if (!playerId) throw new RoomError('Missing player id.', 400);
  if (!rawName) throw new RoomError('Please enter a name.', 400);

  return { playerId, name: rawName.slice(0, 20) };
}

/** One place to turn a RoomError into a response, so every route reads the same. */
async function handleRoom(res: express.Response, work: () => Promise<unknown>) {
  try {
    res.json(await work());
  } catch (err) {
    if (err instanceof RoomError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Room request failed:', err);
    telemetry.failure('rooms', err);
    res.status(500).json({ error: 'Something went wrong with that room.' });
  }
}

app.post('/api/rooms', async (req, res) => {
  await handleRoom(res, async () => {
    const { playerId, name } = readIdentity(req);
    return roomService().create(playerId, name);
  });
});

app.post('/api/rooms/:code/join', async (req, res) => {
  await handleRoom(res, async () => {
    const { playerId, name } = readIdentity(req);
    return roomService().join(req.params.code, playerId, name);
  });
});

// The polling endpoint. Also what marks a player present — on a polling
// transport there is no disconnect event, so absence is inferred from silence.
app.get('/api/rooms/:code', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.query.playerId === 'string' ? req.query.playerId : '';
    if (!playerId) throw new RoomError('Missing player id.', 400);
    return roomService().view(req.params.code, playerId);
  });
});

app.post('/api/rooms/:code/start', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : '';
    if (!playerId) throw new RoomError('Missing player id.', 400);
    return roomService().start(req.params.code, playerId);
  });
});

// How many rounds the match runs for. Host only, and only before round one.
app.post('/api/rooms/:code/rounds', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : '';
    const totalRounds = Number(req.body?.totalRounds);
    if (!playerId) throw new RoomError('Missing player id.', 400);
    if (!Number.isInteger(totalRounds)) throw new RoomError('Missing round count.', 400);
    return roomService().setRounds(req.params.code, playerId, totalRounds);
  });
});

app.post('/api/rooms/:code/new-match', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : '';
    if (!playerId) throw new RoomError('Missing player id.', 400);
    return roomService().newMatch(req.params.code, playerId);
  });
});

app.post('/api/rooms/:code/submit', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : '';
    if (!playerId) throw new RoomError('Missing player id.', 400);

    // ⚠️ Held to the same shape as a solo round. These answers are scored by the
    // same referee, which takes them for strings — a number or an object used to
    // reach it and throw, reporting a malformed request as a server fault.
    const parsed = readAnswers(req.body?.answers);
    if (parsed.error) throw new RoomError(parsed.error, 400);

    // The clock is the server's: nothing the client says about timing is read.
    return roomService().submit(req.params.code, playerId, parsed.answers);
  });
});

app.post('/api/rooms/:code/next', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : '';
    if (!playerId) throw new RoomError('Missing player id.', 400);
    return roomService().next(req.params.code, playerId);
  });
});

app.post('/api/rooms/:code/leave', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : '';
    if (playerId) await roomService().leave(req.params.code, playerId);
    return { ok: true };
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Container platforms send SIGTERM on scale-in and on a new revision.
  // Closing gracefully lets an in-flight round finish rather than dropping a
  // player's submitted answers.
  const shutdown = (signal: string) => {
    console.log(`${signal} received, closing server.`);

    server.close(async () => {
      // Spans sit in a batch processor for a few seconds. Without this flush the
      // telemetry from a replica being recycled is lost — which is exactly the
      // window where a heuristic fallback or a failure matters most.
      await flushTelemetry();
      process.exit(0);
    });

    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();
