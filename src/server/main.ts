// MUST be first: the OpenTelemetry instrumentations patch `http` when they
// load, so anything imported before this is never instrumented.
import { flushTelemetry, telemetryStarted } from './telemetry/init';

import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { getDailyPuzzleData, getRandomPuzzleData } from '../shared/puzzle';
import {
  createAzureJudge,
  evaluateRound,
  heuristicJudge,
  unscoreableCategories,
  withFallback,
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
import { RoomError, createRoomService } from './rooms';

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
  res.json({ status: 'ok', time: new Date().toISOString() });
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

  if (!letter || !answers) {
    return res.status(400).json({ error: 'Missing letter or answers' });
  }

  const started = Date.now();
  let evaluation;

  try {
    evaluation = await evaluateRound(
      {
        letter,
        answers,
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

const rooms = createRoomService({
  judge,
  // Each round draws a fresh letter, skipping the one just played.
  nextPuzzle: async (excludeLetter) => {
    const puzzle = getRandomPuzzleData(excludeLetter);
    const bonusChallenge = await practiceBonus.next(puzzle.letter);
    return { letter: puzzle.letter, bonusChallenge };
  },
});

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
    return rooms.create(playerId, name);
  });
});

app.post('/api/rooms/:code/join', async (req, res) => {
  await handleRoom(res, async () => {
    const { playerId, name } = readIdentity(req);
    return rooms.join(req.params.code, playerId, name);
  });
});

// The polling endpoint. Also what marks a player present — on a polling
// transport there is no disconnect event, so absence is inferred from silence.
app.get('/api/rooms/:code', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.query.playerId === 'string' ? req.query.playerId : '';
    if (!playerId) throw new RoomError('Missing player id.', 400);
    return rooms.view(req.params.code, playerId);
  });
});

app.post('/api/rooms/:code/start', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : '';
    if (!playerId) throw new RoomError('Missing player id.', 400);
    return rooms.start(req.params.code, playerId);
  });
});

// How many rounds the match runs for. Host only, and only before round one.
app.post('/api/rooms/:code/rounds', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : '';
    const totalRounds = Number(req.body?.totalRounds);
    if (!playerId) throw new RoomError('Missing player id.', 400);
    if (!Number.isInteger(totalRounds)) throw new RoomError('Missing round count.', 400);
    return rooms.setRounds(req.params.code, playerId, totalRounds);
  });
});

app.post('/api/rooms/:code/new-match', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : '';
    if (!playerId) throw new RoomError('Missing player id.', 400);
    return rooms.newMatch(req.params.code, playerId);
  });
});

app.post('/api/rooms/:code/submit', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : '';
    const answers = req.body?.answers;
    if (!playerId) throw new RoomError('Missing player id.', 400);
    if (!answers) throw new RoomError('Missing answers.', 400);
    // The clock is the server's: nothing the client says about timing is read.
    return rooms.submit(req.params.code, playerId, answers);
  });
});

app.post('/api/rooms/:code/next', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : '';
    if (!playerId) throw new RoomError('Missing player id.', 400);
    return rooms.next(req.params.code, playerId);
  });
});

app.post('/api/rooms/:code/leave', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : '';
    if (playerId) await rooms.leave(req.params.code, playerId);
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
