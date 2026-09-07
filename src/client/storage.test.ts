import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameResult, GameStats } from './types';
import {
  loadGameStats,
  projectedStreak,
  recordGameCompletion,
  saveGameStats,
  streakAfterCompletion,
} from './storage';

function installLocalStorage(): void {
  const entries = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
  });
}

function statsWith(overrides: Partial<GameStats>): GameStats {
  return {
    gamesPlayed: 0,
    currentStreak: 0,
    maxStreak: 0,
    totalScore: 0,
    wins: 0,
    lastPlayedDate: null,
    history: {},
    ...overrides,
  };
}

function resultFor(dateString: string, totalScore = 40): GameResult {
  return {
    dayNumber: 1,
    dateString,
    letter: 'S',
    answers: { name: 'Sam', place: 'Spain', animal: 'Snake', thing: 'Spoon' },
    validation: {
      categories: {} as GameResult['validation']['categories'],
      totalScore,
      speedBonus: 0,
      bonusChallengeMet: false,
      overallFeedback: '',
    },
    score: totalScore,
    streak: 0,
    timeTaken: 20,
    livesRemaining: 3,
    completedAt: `${dateString}T10:00:00.000Z`,
  };
}

beforeEach(() => {
  installLocalStorage();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-10T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('loadGameStats', () => {
  it('keeps a streak that was extended today', () => {
    saveGameStats(statsWith({ currentStreak: 6, lastPlayedDate: '2026-03-10' }));

    expect(loadGameStats().currentStreak).toBe(6);
  });

  it('keeps a streak that was extended yesterday, since today is still playable', () => {
    saveGameStats(statsWith({ currentStreak: 6, lastPlayedDate: '2026-03-09' }));

    expect(loadGameStats().currentStreak).toBe(6);
  });

  it('reports a broken streak as zero without waiting for the next round', () => {
    saveGameStats(statsWith({ currentStreak: 6, lastPlayedDate: '2026-03-08' }));

    expect(loadGameStats().currentStreak).toBe(0);
  });

  it('reports zero however long ago the last round was', () => {
    saveGameStats(statsWith({ currentStreak: 30, lastPlayedDate: '2025-01-01' }));

    expect(loadGameStats().currentStreak).toBe(0);
  });

  it('leaves every other stat alone when the streak dies', () => {
    saveGameStats(
      statsWith({
        gamesPlayed: 9,
        currentStreak: 6,
        maxStreak: 6,
        totalScore: 315,
        wins: 7,
        lastPlayedDate: '2026-03-08',
      })
    );

    const stats = loadGameStats();

    expect(stats.gamesPlayed).toBe(9);
    expect(stats.maxStreak).toBe(6);
    expect(stats.totalScore).toBe(315);
    expect(stats.wins).toBe(7);
    expect(stats.lastPlayedDate).toBe('2026-03-08');
  });

  it('does not write the decayed streak back, so the last played date stays the record', () => {
    saveGameStats(statsWith({ currentStreak: 6, lastPlayedDate: '2026-03-08' }));

    loadGameStats();

    expect(JSON.parse(localStorage.getItem('npat_game_stats_v1')!).currentStreak).toBe(6);
  });
});

describe('streakAfterCompletion', () => {
  it('extends a streak from the day before', () => {
    const stats = statsWith({ currentStreak: 3, lastPlayedDate: '2026-03-09' });

    expect(streakAfterCompletion(stats, '2026-03-10')).toBe(4);
  });

  it('restarts at one after a missed day', () => {
    const stats = statsWith({ currentStreak: 3, lastPlayedDate: '2026-03-08' });

    expect(streakAfterCompletion(stats, '2026-03-10')).toBe(1);
  });

  it('starts at one for a first ever round', () => {
    expect(streakAfterCompletion(statsWith({}), '2026-03-10')).toBe(1);
  });

  it('does not count the same day twice', () => {
    const stats = statsWith({ currentStreak: 3, lastPlayedDate: '2026-03-10' });

    expect(streakAfterCompletion(stats, '2026-03-10')).toBe(3);
  });

  it('crosses a month boundary', () => {
    const stats = statsWith({ currentStreak: 3, lastPlayedDate: '2026-02-28' });

    expect(streakAfterCompletion(stats, '2026-03-01')).toBe(4);
  });
});

describe('recordGameCompletion', () => {
  it('extends the streak on consecutive days', () => {
    saveGameStats(statsWith({ currentStreak: 4, maxStreak: 4, lastPlayedDate: '2026-03-09' }));

    expect(recordGameCompletion(resultFor('2026-03-10')).currentStreak).toBe(5);
  });

  it('restarts the streak after a gap but keeps the best', () => {
    saveGameStats(statsWith({ currentStreak: 9, maxStreak: 9, lastPlayedDate: '2026-03-01' }));

    const stats = recordGameCompletion(resultFor('2026-03-10'));

    expect(stats.currentStreak).toBe(1);
    expect(stats.maxStreak).toBe(9);
  });

  it('agrees with the streak the result card already showed', () => {
    saveGameStats(statsWith({ currentStreak: 4, maxStreak: 4, lastPlayedDate: '2026-03-09' }));

    const shown = projectedStreak('2026-03-10');

    expect(recordGameCompletion(resultFor('2026-03-10')).currentStreak).toBe(shown);
  });

  it('agrees with the result card after a broken streak too', () => {
    saveGameStats(statsWith({ currentStreak: 9, maxStreak: 9, lastPlayedDate: '2026-03-01' }));

    const shown = projectedStreak('2026-03-10');

    expect(recordGameCompletion(resultFor('2026-03-10')).currentStreak).toBe(shown);
  });
});
