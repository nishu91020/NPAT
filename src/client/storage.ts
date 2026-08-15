import { GameResult, GameStats } from './types';

const STATS_KEY = 'npat_game_stats_v1';
const TODAY_RESULT_KEY = 'npat_today_result_v1';
const PLAYER_KEY = 'npat_player_v1';
const SEAT_KEY = 'npat_room_seat_v1';

export interface PlayerIdentity {
  id: string;
  name: string;
}

function newPlayerId(): string {

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

export interface RoomSeat {
  code: string;
  token: string;
}

export function loadRoomSeat(code: string): string {
  try {
    const raw = localStorage.getItem(SEAT_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as Partial<RoomSeat>;
    if (parsed?.code?.toUpperCase() === code.toUpperCase() && parsed.token) return parsed.token;
  } catch {

  }
  return '';
}

export function saveRoomSeat(seat: RoomSeat): void {
  try {
    localStorage.setItem(SEAT_KEY, JSON.stringify(seat));
  } catch (e) {
    console.error('Failed to save room seat to localStorage', e);
  }
}

export function clearRoomSeat(): void {
  try {
    localStorage.removeItem(SEAT_KEY);
  } catch {

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

  const isNewDailyDay = currentStats.lastPlayedDate !== dateKey;

  let newStreak = currentStats.currentStreak;
  if (isNewDailyDay) {

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (currentStats.lastPlayedDate === yesterdayStr || currentStats.lastPlayedDate === null) {
      newStreak = currentStats.currentStreak + 1;
    } else {
      newStreak = 1;
    }
  }

  const maxStreak = Math.max(currentStats.maxStreak, newStreak);
  const isWin = result.validation.totalScore >= 20;

  const updatedStats: GameStats = {
    ...currentStats,
    gamesPlayed: currentStats.gamesPlayed + 1,
    currentStreak: newStreak,
    maxStreak,
    totalScore: currentStats.totalScore + result.score,
    wins: currentStats.wins + (isWin ? 1 : 0),
    lastPlayedDate: dateKey,
    history: {
      ...currentStats.history,
      [result.completedAt]: result,
    },
  };

  saveGameStats(updatedStats);

  try {
    localStorage.setItem(TODAY_RESULT_KEY, JSON.stringify(result));
  } catch (e) {}

  return updatedStats;
}

export function loadTodayDailyResult(dateString: string): GameResult | null {
  try {
    const raw = localStorage.getItem(TODAY_RESULT_KEY);
    if (!raw) return null;
    const parsed: GameResult = JSON.parse(raw);

    if (parsed.dateString === dateString) {
      return parsed;
    }
    return null;
  } catch (e) {
    return null;
  }
}
