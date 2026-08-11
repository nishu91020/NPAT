import { GameResult, GameStats } from './types';

const STATS_KEY = 'npat_game_stats_v1';
const TODAY_RESULT_KEY = 'npat_today_result_v1';
const PLAYER_KEY = 'npat_player_v1';

/**
 * Who this browser is, in a room.
 *
 * There are no accounts, so a room needs *something* stable to recognise a
 * returning player by — otherwise a refresh mid-round looks like a stranger
 * arriving and the original seat is stranded. The id is generated once and kept;
 * the name rides along so the join form can prefill it.
 */
export interface PlayerIdentity {
  id: string;
  name: string;
}

function newPlayerId(): string {
  // randomUUID needs a secure context, which excludes plain-http LAN testing.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadPlayerIdentity(): PlayerIdentity {
  try {
    const raw = localStorage.getItem(PLAYER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PlayerIdentity>;
      if (parsed?.id) return { id: parsed.id, name: parsed.name ?? '' };
    }
  } catch {
    // A corrupt entry is not worth failing over — issue a fresh identity.
  }

  const identity = { id: newPlayerId(), name: '' };
  savePlayerIdentity(identity);
  return identity;
}

export function savePlayerIdentity(identity: PlayerIdentity): void {
  try {
    localStorage.setItem(PLAYER_KEY, JSON.stringify(identity));
  } catch (e) {
    console.error('Failed to save player identity to localStorage', e);
  }
}

const DEFAULT_STATS: GameStats = {
  gamesPlayed: 0,
  currentStreak: 0,
  maxStreak: 0,
  totalScore: 0,
  wins: 0,
  lastPlayedDate: null,
  history: {},
};

export function loadGameStats(): GameStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return DEFAULT_STATS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATS, ...parsed };
  } catch (e) {
    return DEFAULT_STATS;
  }
}

export function saveGameStats(stats: GameStats): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (e) {
    console.error('Failed to save game stats to localStorage', e);
  }
}

export function recordGameCompletion(result: GameResult): GameStats {
  const currentStats = loadGameStats();
  const dateKey = result.dateString;

  // Don't double count daily streak for the exact same date if already recorded
  const isNewDailyDay = result.mode === 'daily' && currentStats.lastPlayedDate !== dateKey;

  let newStreak = currentStats.currentStreak;
  if (isNewDailyDay) {
    // Check if consecutive day
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (currentStats.lastPlayedDate === yesterdayStr || currentStats.lastPlayedDate === null) {
      newStreak = currentStats.currentStreak + 1;
    } else {
      newStreak = 1; // reset streak if missed a day
    }
  }

  const maxStreak = Math.max(currentStats.maxStreak, newStreak);
  const isWin = result.validation.totalScore >= 20;

  const updatedStats: GameStats = {
    ...currentStats,
    gamesPlayed: currentStats.gamesPlayed + 1,
    currentStreak: result.mode === 'daily' ? newStreak : currentStats.currentStreak,
    maxStreak: result.mode === 'daily' ? maxStreak : currentStats.maxStreak,
    totalScore: currentStats.totalScore + result.score,
    wins: currentStats.wins + (isWin ? 1 : 0),
    lastPlayedDate: result.mode === 'daily' ? dateKey : currentStats.lastPlayedDate,
    history: {
      ...currentStats.history,
      [result.completedAt]: result,
    },
  };

  saveGameStats(updatedStats);

  if (result.mode === 'daily') {
    try {
      localStorage.setItem(TODAY_RESULT_KEY, JSON.stringify(result));
    } catch (e) {}
  }

  return updatedStats;
}

export function loadTodayDailyResult(dateString: string): GameResult | null {
  try {
    const raw = localStorage.getItem(TODAY_RESULT_KEY);
    if (!raw) return null;
    const parsed: GameResult = JSON.parse(raw);
    if (parsed.dateString === dateString && parsed.mode === 'daily') {
      return parsed;
    }
    return null;
  } catch (e) {
    return null;
  }
}
