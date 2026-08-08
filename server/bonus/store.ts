import { BonusChallenge } from '../../src/types';

/**
 * A shared place to keep the day's bonus challenge.
 *
 * The daily challenge must be identical for every player, so it cannot live in
 * one process's memory once there is more than one replica — each would
 * generate and serve its own. This seam moves the source of truth outside the
 * process.
 */
export interface DailyChallengeStore {
  /** The stored challenge for a date, or null when nothing is stored yet. */
  get(dateStr: string): Promise<BonusChallenge | null>;
  /** Stores the challenge for a date. Last writer wins; see putIfAbsent. */
  put(dateStr: string, challenge: BonusChallenge): Promise<void>;
  /**
   * Stores only when nothing exists for that date, and returns whichever
   * challenge is now current. Lets concurrent replicas converge on one value
   * instead of overwriting each other.
   */
  putIfAbsent(dateStr: string, challenge: BonusChallenge): Promise<BonusChallenge>;
}

/** Used when no store is configured: the app falls back to deterministic challenges. */
export const nullStore: DailyChallengeStore = {
  async get() {
    return null;
  },
  async put() {
    /* nothing is stored */
  },
  async putIfAbsent(_dateStr, challenge) {
    return challenge;
  },
};

/** In-memory store. The test substitute, and a single-replica fallback. */
export function createMemoryStore(): DailyChallengeStore {
  const byDate = new Map<string, BonusChallenge>();

  return {
    async get(dateStr) {
      return byDate.get(dateStr) ?? null;
    },
    async put(dateStr, challenge) {
      byDate.set(dateStr, challenge);
    },
    async putIfAbsent(dateStr, challenge) {
      const existing = byDate.get(dateStr);
      if (existing) return existing;

      byDate.set(dateStr, challenge);
      return challenge;
    },
  };
}
