import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { getDailyPuzzleData, getRandomPuzzleData } from './src/utils/puzzleData';
import {
  createAzureJudge,
  evaluateRound,
  heuristicJudge,
  withFallback,
  type Judge,
} from './server/referee';
import {
  cachedPerDate,
  createAzureBonusSource,
  deterministicSourceForDate,
  randomBuiltinSource,
  withBonusFallback,
  type BonusChallengeSource,
} from './server/bonus';
import {
  createAzureClient,
  describeIncompleteConfig,
  resolveAzureConfig,
  type AzureClient,
} from './server/azure';

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

// One generation per date, shared by every player, with the deterministic
// challenge as the fallback.
const dailyBonus = cachedPerDate((dateStr) =>
  aiBonusSource
    ? withBonusFallback(aiBonusSource, deterministicSourceForDate(dateStr))
    : deterministicSourceForDate(dateStr)
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

  try {
    const evaluation = await evaluateRound(
      {
        letter,
        answers,
        bonusChallenge,
        timeTakenSeconds:
          typeof timeTakenSeconds === 'number' ? timeTakenSeconds : DEFAULT_TIME_TAKEN_SECONDS,
      },
      judge
    );

    res.json(evaluation);
  } catch (err) {
    console.error('Round evaluation failed:', err);
    res.status(500).json({ error: 'Could not evaluate this round' });
  }
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
    server.close(() => process.exit(0));

    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();
