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
import { RoomError, createBlobRoomStore, createMemoryRoomStore, createRoomService, type PlayerSeat, type RoomService, type RoomStore } from './rooms';

import {
  createAzureMonitorTelemetry,
  noopTelemetry,
  type Telemetry,
} from './telemetry';

dotenv.config({ path: '.env' });
dotenv.config();

const app = express();

const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '64kb' }));

const DEFAULT_TIME_TAKEN_SECONDS = 40;

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

const judge: Judge = azure
  ? withFallback(createAzureJudge(azure.client, azure.judgeDeployment), heuristicJudge)
  : heuristicJudge;

const bonusAdjudicator: BonusAdjudicator | undefined = azure
  ? createAzureBonusAdjudicator(azure.client, azure.judgeDeployment)
  : undefined;

const dailyAiSourceFor = azure
  ? (dateStr: string) =>
      createAzureBonusSource(azure.client, azure.bonusDeployment, () => ruleFamilyForDate(dateStr))
  : null;

const roomAiSource: BonusChallengeSource | null = azure
  ? createAzureBonusSource(azure.client, azure.bonusDeployment, createRecentAvoidingPicker())
  : null;

const hasAiBonusSource = Boolean(azure);

function createDailyChallengeStore(): DailyChallengeStore {
  const target = process.env.DAILY_CHALLENGE_STORAGE?.trim();
  if (!target) return nullStore;

  console.log('Daily challenge store enabled.');
  return createBlobStore(target);
}

const dailyChallengeStore = createDailyChallengeStore();

const telemetry: Telemetry = telemetryStarted ? createAzureMonitorTelemetry() : noopTelemetry;

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

const randomBonus: BonusChallengeSource = roomAiSource
  ? withBonusFallback(roomAiSource, randomBuiltinSource)
  : randomBuiltinSource;

app.get('/api/health', (req, res) => {

  res.json({ status: 'ok', time: new Date().toISOString(), rooms: roomsMode });
});

app.get('/api/daily-challenge', async (req, res) => {
  const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0];
  const basePuzzle = getDailyPuzzleData(dateStr);
  const bonusChallenge = await dailyBonus.forDate(dateStr, basePuzzle.letter);

  res.json({ ...basePuzzle, bonusChallenge, isRealtimeBonus: hasAiBonusSource });
});

app.post('/api/generate-bonus', async (req, res) => {
  const bonusChallenge = await randomBonus.next(req.body?.letter || 'S');
  res.json(bonusChallenge);
});

app.post('/api/validate', async (req, res) => {
  const { letter, answers, bonusChallenge, timeTakenSeconds } = req.body ?? {};

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

  telemetry.roundJudged({
    judgedBy: evaluation.judgedBy,
    durationMs: Date.now() - started,
    totalScore: evaluation.totalScore,
    filteredCategories: unscoreableCategories(evaluation.categories),
  });
});

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

      nextPuzzle: async (excludeLetter) => {
        const puzzle = getRandomPuzzleData(excludeLetter);
        const bonusChallenge = await randomBonus.next(puzzle.letter);
        return { letter: puzzle.letter, bonusChallenge };
      },
    })
  : null;

function roomService(): RoomService {
  if (!rooms) {
    throw new RoomError('Rooms are not enabled on this deployment.', 503);
  }
  return rooms;
}

function readIdentity(req: express.Request): { playerId: string; name: string; token: string } {
  const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId.trim() : '';
  const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';

  if (!playerId) throw new RoomError('Missing player id.', 400);
  if (!rawName) throw new RoomError('Please enter a name.', 400);

  return { playerId, name: rawName.slice(0, 20), token };
}

function readSeat(req: express.Request): PlayerSeat {
  const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : '';
  const token = typeof req.body?.token === 'string' ? req.body.token : '';

  if (!playerId) throw new RoomError('Missing player id.', 400);
  if (!token) throw new RoomError('You are not in this room.', 403);

  return { playerId, token };
}

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
    const { playerId, name, token } = readIdentity(req);
    return roomService().join(req.params.code, playerId, name, token);
  });
});

app.get('/api/rooms/:code', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.query.playerId === 'string' ? req.query.playerId : '';
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!playerId) throw new RoomError('Missing player id.', 400);

    if (!token) throw new RoomError('You are not in this room.', 403);
    return roomService().view(req.params.code, { playerId, token });
  });
});

app.post('/api/rooms/:code/start', async (req, res) => {
  await handleRoom(res, async () => {
    return roomService().start(req.params.code, readSeat(req));
  });
});

app.post('/api/rooms/:code/rounds', async (req, res) => {
  await handleRoom(res, async () => {
    const seat = readSeat(req);
    const totalRounds = Number(req.body?.totalRounds);
    if (!Number.isInteger(totalRounds)) throw new RoomError('Missing round count.', 400);
    return roomService().setRounds(req.params.code, seat, totalRounds);
  });
});

app.post('/api/rooms/:code/new-match', async (req, res) => {
  await handleRoom(res, async () => {
    return roomService().newMatch(req.params.code, readSeat(req));
  });
});

app.post('/api/rooms/:code/submit', async (req, res) => {
  await handleRoom(res, async () => {
    const seat = readSeat(req);

    const parsed = readAnswers(req.body?.answers);
    if (parsed.error) throw new RoomError(parsed.error, 400);

    return roomService().submit(req.params.code, seat, parsed.answers);
  });
});

app.post('/api/rooms/:code/next', async (req, res) => {
  await handleRoom(res, async () => {
    return roomService().next(req.params.code, readSeat(req));
  });
});

app.post('/api/rooms/:code/leave', async (req, res) => {
  await handleRoom(res, async () => {
    const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : '';
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (playerId && token) await roomService().leave(req.params.code, { playerId, token });
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

  const shutdown = (signal: string) => {
    console.log(`${signal} received, closing server.`);

    server.close(async () => {

      await flushTelemetry();
      process.exit(0);
    });

    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();
