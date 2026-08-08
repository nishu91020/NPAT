import { BonusChallenge } from '../../src/types';

/** The seam for producing a bonus challenge. */
export interface BonusChallengeSource {
  next(letter: string): Promise<BonusChallenge>;
}

/** Tries the primary source and falls back on failure. */
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

/**
 * Makes a source stable for a given day.
 *
 * The daily puzzle's letter is derived deterministically from the date, but its
 * bonus challenge was previously generated per request at temperature 0.8 —
 * so it changed on every refresh and differed between players. Caching the
 * in-flight promise per date collapses that to one generation per day and
 * prevents a stampede on first request.
 */
export function cachedPerDate(
  sourceFor: (dateStr: string) => BonusChallengeSource,
  maxDays = 7
) {
  const cache = new Map<string, Promise<BonusChallenge>>();

  return {
    async forDate(dateStr: string, letter: string): Promise<BonusChallenge> {
      const cached = cache.get(dateStr);
      if (cached) return cached;

      const pending = sourceFor(dateStr).next(letter);
      cache.set(dateStr, pending);

      // Keep the map from growing without bound across a long-lived process.
      if (cache.size > maxDays) {
        const oldest = [...cache.keys()].sort()[0];
        if (oldest) cache.delete(oldest);
      }

      return pending;
    },
  };
}
