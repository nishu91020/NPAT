import { describe, expect, it } from 'vitest';
import { BonusChallenge } from '../../src/types';
import { deterministicSourceForDate } from './builtinSource';
import { BonusChallengeSource, cachedPerDate, withBonusFallback } from './types';

function fixed(id: string): BonusChallenge {
  return { id, title: id, description: id, icon: 'Sparkles', ruleHint: id };
}

function countingSource(): BonusChallengeSource & { calls: number } {
  const source = {
    calls: 0,
    async next() {
      source.calls++;
      return fixed(`generated_${source.calls}`);
    },
  };
  return source;
}

describe('cachedPerDate', () => {
  it('generates once per date, so every player sees the same bonus', async () => {
    const source = countingSource();
    const daily = cachedPerDate(() => source);

    const first = await daily.forDate('2026-08-08', 'S');
    const second = await daily.forDate('2026-08-08', 'S');
    const third = await daily.forDate('2026-08-08', 'S');

    expect(source.calls).toBe(1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('generates separately for a different date', async () => {
    const source = countingSource();
    const daily = cachedPerDate(() => source);

    await daily.forDate('2026-08-08', 'S');
    await daily.forDate('2026-08-09', 'T');

    expect(source.calls).toBe(2);
  });

  it('shares one in-flight generation between concurrent callers', async () => {
    const source = countingSource();
    const daily = cachedPerDate(() => source);

    const [a, b] = await Promise.all([
      daily.forDate('2026-08-08', 'S'),
      daily.forDate('2026-08-08', 'S'),
    ]);

    expect(source.calls).toBe(1);
    expect(a).toEqual(b);
  });

  it('evicts old dates rather than growing without bound', async () => {
    const source = countingSource();
    const daily = cachedPerDate(() => source, 2);

    await daily.forDate('2026-08-01', 'A');
    await daily.forDate('2026-08-02', 'B');
    await daily.forDate('2026-08-03', 'C');

    // The oldest date was evicted, so asking again regenerates.
    await daily.forDate('2026-08-01', 'A');
    expect(source.calls).toBe(4);
  });
});

describe('withBonusFallback', () => {
  it('falls back when the primary source throws', async () => {
    const failing: BonusChallengeSource = {
      async next() {
        throw new Error('primary source exploded');
      },
    };

    const source = withBonusFallback(failing, deterministicSourceForDate('2026-08-08'));
    const result = await source.next('I');

    expect(result.id).toBeTruthy();
    expect(result.title).toBeTruthy();
  });
});

describe('deterministicSourceForDate', () => {
  it('returns the same challenge for the same date', async () => {
    const a = await deterministicSourceForDate('2026-08-08').next('I');
    const b = await deterministicSourceForDate('2026-08-08').next('I');

    expect(a).toEqual(b);
  });
});
