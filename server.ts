import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { getDailyPuzzleData, getRandomPuzzleData } from './src/utils/puzzleData';
import {
  createGeminiJudge,
  evaluateRound,
  heuristicJudge,
  withFallback,
  type Judge,
} from './server/referee';
import {
  cachedPerDate,
  createGeminiBonusSource,
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
const PORT = 3000;

app.use(express.json());

/** Used only when a caller omits the field; the app always sends a real value. */
const DEFAULT_TIME_TAKEN_SECONDS = 40;

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
}

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
const ai = createGeminiClient();

if (azure) {
  console.log('Microsoft Foundry configured; judge deployment:', azure.judgeDeployment);
}

// Gemini judges when configured; the heuristic covers both "no key" and "call failed".
const judge: Judge = ai ? withFallback(createGeminiJudge(ai), heuristicJudge) : heuristicJudge;

// One generation per date, shared by every player, with the deterministic
// challenge as the fallback.
const dailyBonus = cachedPerDate((dateStr) =>
  ai
    ? withBonusFallback(createGeminiBonusSource(ai), deterministicSourceForDate(dateStr))
    : deterministicSourceForDate(dateStr)
);

const practiceBonus: BonusChallengeSource = ai
  ? withBonusFallback(createGeminiBonusSource(ai), randomBuiltinSource)
  : randomBuiltinSource;

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/daily-challenge', async (req, res) => {
  const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0];
  const basePuzzle = getDailyPuzzleData(dateStr);
  const bonusChallenge = await dailyBonus.forDate(dateStr, basePuzzle.letter);

  res.json({ ...basePuzzle, bonusChallenge, isRealtimeBonus: Boolean(ai) });
});

app.get('/api/practice-challenge', async (req, res) => {
  const excludeLetter = req.query.exclude as string;
  const basePuzzle = getRandomPuzzleData(excludeLetter);
  const bonusChallenge = await practiceBonus.next(basePuzzle.letter);

  res.json({ ...basePuzzle, bonusChallenge, isRealtimeBonus: Boolean(ai) });
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
