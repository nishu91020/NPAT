// MUST be first: the OpenTelemetry instrumentations patch `http` when they
// load, so anything imported before this is never instrumented.
import { flushTelemetry, telemetryStarted } from './server/telemetry/init';

import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { getDailyPuzzleData, getRandomPuzzleData } from './src/utils/puzzleData';
import {
  createAzureJudge,
  evaluateRound,
  heuristicJudge,
  unscoreableCategories,
  withFallback,
  type Judge,
} from './server/referee';
import {
  cachedPerDate,
  createAzureBonusSource,
  createBlobStore,
  deterministicSourceForDate,
  nullStore,
  randomBuiltinSource,
  withBonusFallback,
  type BonusChallengeSource,
  type DailyChallengeStore,
} from './server/bonus';
import {
  createAzureClient,
  describeIncompleteConfig,
  resolveAzureConfig,
  type AzureClient,
} from './server/azure';

import {
  createAzureMonitorTelemetry,
  noopTelemetry,
  type Telemetry,
} from './server/telemetry';

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

const aiBonusSource: BonusChallengeSource | null = azure
  ? createAzureBonusSource(azure.client, azure.bonusDeployment)
  : null;

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
    aiBonusSource
      ? withBonusFallback(aiBonusSource, deterministicSourceForDate(dateStr))
      : deterministicSourceForDate(dateStr),
  {
    store: dailyChallengeStore,
    onServed: (origin, dateStr) => telemetry.dailyChallengeServed({ origin, dateStr }),
  }
);

const practiceBonus: BonusChallengeSource = aiBonusSource
  ? withBonusFallback(aiBonusSource, randomBuiltinSource)
  : randomBuiltinSource;

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/daily-challenge', async (req, res) => {
  const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0];
  const basePuzzle = getDailyPuzzleData(dateStr);
  const bonusChallenge = await dailyBonus.forDate(dateStr, basePuzzle.letter);

  res.json({ ...basePuzzle, bonusChallenge, isRealtimeBonus: Boolean(aiBonusSource) });
});

app.get('/api/practice-challenge', async (req, res) => {
  const excludeLetter = req.query.exclude as string;
  const basePuzzle = getRandomPuzzleData(excludeLetter);
  const bonusChallenge = await practiceBonus.next(basePuzzle.letter);

  res.json({ ...basePuzzle, bonusChallenge, isRealtimeBonus: Boolean(aiBonusSource) });
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
