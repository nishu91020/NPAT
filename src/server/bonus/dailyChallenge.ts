import { BonusChallenge } from '../../shared/contract';
import { DailyChallengeOrigin } from '../telemetry/types';

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
    // intentionally no-op: app falls back to per-process caching when no shared store is configured
  },
  async putIfAbsent(_dateStr, challenge) {
    return challenge;
  },
};

export interface BonusChallengeSource {
  next(letter: string): Promise<BonusChallenge>;
}

export function withBonusFallback(
  primary: BonusChallengeSource,
  fallback: BonusChallengeSource
): BonusChallengeSource {
  return {
    async next(letter) {
      try {
        return await primary.next(letter);
      } catch (err) {
        console.error('Primary bonus source failed, falling back:', err);
        return fallback.next(letter);
      }
    },
  };
}

export function cachedPerDate(
  sourceFor: (dateStr: string) => BonusChallengeSource,
  options: {
    store?: DailyChallengeStore;
    maxDays?: number;
    onServed?: (origin: DailyChallengeOrigin, dateStr: string) => void;
  } = {}
) {
  const store = options.store ?? nullStore;
  const maxDays = options.maxDays ?? 7;
  const onServed = options.onServed ?? (() => {});
  const cache = new Map<string, Promise<BonusChallenge>>();

  async function resolve(dateStr: string, letter: string): Promise<BonusChallenge> {
    const stored = await store.get(dateStr);
    if (stored) {
      onServed('store', dateStr);
      return stored;
    }

    const generated = await sourceFor(dateStr).next(letter);
    const published = await store.putIfAbsent(dateStr, generated);

    onServed(published === generated ? 'generated' : 'store', dateStr);

    return published;
  }

  return {
    async forDate(dateStr: string, letter: string): Promise<BonusChallenge> {
      const cached = cache.get(dateStr);
      if (cached) {
        onServed('memory', dateStr);
        return cached;
      }

      const pending = resolve(dateStr, letter);
      cache.set(dateStr, pending);

      pending.catch(() => cache.delete(dateStr));

      if (cache.size > maxDays) {
        const oldest = [...cache.keys()].sort()[0];
        if (oldest) cache.delete(oldest);
      }

      return pending;
    },
  };
}
