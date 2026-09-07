import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit';

const MINUTE = 60_000;

describe('createRateLimiter', () => {
  it('allows requests up to the limit', () => {
    const limiter = createRateLimiter({ limit: 3, windowSeconds: 600 });

    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('a', 1).allowed).toBe(true);
    expect(limiter.check('a', 2).allowed).toBe(true);
  });

  it('denies the request past the limit', () => {
    const limiter = createRateLimiter({ limit: 3, windowSeconds: 600 });

    limiter.check('a', 0);
    limiter.check('a', 1);
    limiter.check('a', 2);

    expect(limiter.check('a', 3).allowed).toBe(false);
  });

  it('says how long to wait, measured from the oldest request still counted', () => {
    const limiter = createRateLimiter({ limit: 2, windowSeconds: 600 });

    limiter.check('a', 0);
    limiter.check('a', MINUTE);

    expect(limiter.check('a', 2 * MINUTE).retryAfterSeconds).toBe(480);
  });

  it('never asks for a zero second wait, which a client would retry immediately', () => {
    const limiter = createRateLimiter({ limit: 1, windowSeconds: 600 });

    limiter.check('a', 0);

    expect(limiter.check('a', 600_000 - 1).retryAfterSeconds).toBe(1);
  });

  it('lets the window slide rather than locking out until it fully resets', () => {
    const limiter = createRateLimiter({ limit: 2, windowSeconds: 600 });

    limiter.check('a', 0);
    limiter.check('a', MINUTE);

    expect(limiter.check('a', 9 * MINUTE).allowed).toBe(false);

    expect(limiter.check('a', 10 * MINUTE).allowed).toBe(true);

    expect(limiter.check('a', 10 * MINUTE + 1).allowed).toBe(false);
    expect(limiter.check('a', 11 * MINUTE).allowed).toBe(true);
  });

  it('does not let a denied request extend the wait, so a retrying client still recovers', () => {
    const limiter = createRateLimiter({ limit: 1, windowSeconds: 600 });

    limiter.check('a', 0);
    for (let attempt = 1; attempt < 60; attempt += 1) limiter.check('a', attempt * 1000);

    expect(limiter.check('a', 10 * MINUTE).allowed).toBe(true);
  });

  it('counts each key separately', () => {
    const limiter = createRateLimiter({ limit: 1, windowSeconds: 600 });

    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('b', 0).allowed).toBe(true);
    expect(limiter.check('a', 1).allowed).toBe(false);
    expect(limiter.check('b', 1).allowed).toBe(false);
  });

  it('treats a limit below one as one, so a stray config cannot open the gate', () => {
    const limiter = createRateLimiter({ limit: 0, windowSeconds: 600 });

    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('a', 1).allowed).toBe(false);
  });

  it('forgets keys that have gone quiet instead of growing forever', () => {
    const limiter = createRateLimiter({ limit: 1, windowSeconds: 600, maxKeys: 2 });

    for (let visitor = 0; visitor < 500; visitor += 1) {
      limiter.check(`visitor-${visitor}`, visitor);
    }
    expect(limiter.size()).toBeGreaterThan(2);

    limiter.check('late', 20 * MINUTE);

    expect(limiter.size()).toBe(1);
  });

  it('keeps keys that are still inside the window while sweeping', () => {
    const limiter = createRateLimiter({ limit: 5, windowSeconds: 600, maxKeys: 1 });

    limiter.check('a', 0);
    limiter.check('b', MINUTE);
    limiter.check('c', 2 * MINUTE);

    expect(limiter.check('a', 3 * MINUTE).allowed).toBe(true);
    expect(limiter.size()).toBe(3);
  });
});
