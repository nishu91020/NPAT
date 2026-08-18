import { BonusChallenge } from '../../shared/contract';

export interface DailyChallengeStore {

  get(dateStr: string): Promise<BonusChallenge | null>;

  put(dateStr: string, challenge: BonusChallenge): Promise<void>;

  putIfAbsent(dateStr: string, challenge: BonusChallenge): Promise<BonusChallenge>;
}

export const nullStore: DailyChallengeStore = {
  async get() {
    return null;
  },
  async put() {

  },
  async putIfAbsent(_dateStr, challenge) {
    return challenge;
  },
};

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
