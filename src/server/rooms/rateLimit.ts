export interface RateLimitDecision {
  allowed: boolean;

  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  limit: number;

  windowSeconds: number;

  maxKeys?: number;
}

export interface RateLimiter {
  check(key: string, now?: number): RateLimitDecision;

  size(): number;
}

const DEFAULT_MAX_KEYS = 10_000;

const ALLOWED: RateLimitDecision = { allowed: true, retryAfterSeconds: 0 };

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const limit = Math.max(1, Math.floor(options.limit));
  const windowMs = Math.max(1, Math.floor(options.windowSeconds)) * 1000;
  const maxKeys = Math.max(1, Math.floor(options.maxKeys ?? DEFAULT_MAX_KEYS));

  const hits = new Map<string, number[]>();

  function withinWindow(times: number[], cutoff: number): number[] {
    let expired = 0;
    while (expired < times.length && times[expired] <= cutoff) expired += 1;
    return expired === 0 ? times : times.slice(expired);
  }

  function sweep(cutoff: number): void {
    for (const [key, times] of hits) {
      const live = withinWindow(times, cutoff);
      if (live.length === 0) hits.delete(key);
      else hits.set(key, live);
    }
  }

  return {
    check(key, now = Date.now()) {
      const cutoff = now - windowMs;

      if (hits.size > maxKeys) sweep(cutoff);

      const recent = withinWindow(hits.get(key) ?? [], cutoff);
      hits.set(key, recent);

      if (recent.length >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)),
        };
      }

      recent.push(now);
      return ALLOWED;
    },

    size() {
      return hits.size;
    },
  };
}
