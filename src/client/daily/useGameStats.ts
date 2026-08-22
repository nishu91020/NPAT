import { useState } from 'react';
import type { GameResult, GameStats } from '../types';
import { loadGameStats, recordGameCompletion } from '../storage';

export interface StatsController {
  stats: GameStats;
  record: (result: GameResult) => void;
}

export function useGameStats(): StatsController {
  const [stats, setStats] = useState<GameStats>(loadGameStats);

  return {
    stats,
    record: (result) => setStats(recordGameCompletion(result)),
  };
}
