import { describe, expect, it, vi } from 'vitest';
import { BonusChallenge } from '../../src/types';
import { createMemoryStore, nullStore } from './store';
import { BonusChallengeSource, cachedPerDate } from './types';

function challenge(id: string): BonusChallenge {
  return { id, title: id, description: id, icon: 'Sparkles', ruleHint: id };
}

/** A source that returns a distinct challenge each call, so drift is visible. */
function countingSource(label: string): BonusChallengeSource & { calls: number } {
  const source = {
    calls: 0,
    async next() {
      source.calls++;
      return challenge(`${label}-${source.calls}`);
    },
  };
  return source;
}

const DATE = '2026-08-08';

describe('cachedPerDate with a shared store', () => {
  it('serves the same challenge to replicas that never generated it', async () => {
    const store = createMemoryStore();
    const first = countingSource('replica-a');
    const second = countingSource('replica-b');

    const replicaA = cachedPerDate(() => first, { store });
    const replicaB = cachedPerDate(() => second, { store });

    const a = await replicaA.forDate(DATE, 'S');
    const b = await replicaB.forDate(DATE, 'S');

    // Without a shared store these would be replica-a-1 and replica-b-1.
    expect(b).toEqual(a);
    expect(second.calls).toBe(0);
  });

  it('lets the first writer win when replicas race', async () => {
    const store = createMemoryStore();
    const first = countingSource('replica-a');
    const second = countingSource('replica-b');

    // Both miss the empty store, so both generate before either publishes.
    const [a, b] = await Promise.all([
      cachedPerDate(() => first, { store }).forDate(DATE, 'S'),
      cachedPerDate(() => second, { store }).forDate(DATE, 'S'),
    ]);

    expect(a).toEqual(b);
    expect(await store.get(DATE)).toEqual(a);
  });

  it('reads through the store only once per date, then serves from memory', async () => {
    const store = createMemoryStore();
    const spy = vi.spyOn(store, 'get');
    const source = countingSource('replica-a');
    const daily = cachedPerDate(() => source, { store });

    await daily.forDate(DATE, 'S');
    await daily.forDate(DATE, 'S');
    await daily.forDate(DATE, 'S');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(source.calls).toBe(1);
  });

  it('publishes a generated challenge so later replicas can adopt it', async () => {
    const store = createMemoryStore();
    const source = countingSource('replica-a');

    const generated = await cachedPerDate(() => source, { store }).forDate(DATE, 'S');

    expect(await store.get(DATE)).toEqual(generated);
  });

  it('keeps dates independent', async () => {
    const store = createMemoryStore();
    const source = countingSource('replica-a');
    const daily = cachedPerDate(() => source, { store });

    const first = await daily.forDate('2026-08-08', 'S');
    const second = await daily.forDate('2026-08-09', 'T');

    expect(second).not.toEqual(first);
    expect(source.calls).toBe(2);
  });

  it('does not cache a failure, so the day is not poisoned until restart', async () => {
    const store = createMemoryStore();
    let attempt = 0;
    const flaky: BonusChallengeSource = {
      async next() {
        attempt++;
        if (attempt === 1) throw new Error('generation failed');
        return challenge('recovered');
      },
    };

    const daily = cachedPerDate(() => flaky, { store });

    await expect(daily.forDate(DATE, 'S')).rejects.toThrow('generation failed');
    await expect(daily.forDate(DATE, 'S')).resolves.toEqual(challenge('recovered'));
  });

  it('falls back to per-process caching when no store is configured', async () => {
    const source = countingSource('replica-a');
    const daily = cachedPerDate(() => source, { store: nullStore });

    const a = await daily.forDate(DATE, 'S');
    const b = await daily.forDate(DATE, 'S');

    expect(b).toEqual(a);
    expect(source.calls).toBe(1);
  });
});

describe('createMemoryStore', () => {
  it('returns null for a date it has never seen', async () => {
    expect(await createMemoryStore().get(DATE)).toBeNull();
  });

  it('round-trips a challenge', async () => {
    const store = createMemoryStore();
    await store.put(DATE, challenge('stored'));

    expect(await store.get(DATE)).toEqual(challenge('stored'));
  });

  it('putIfAbsent keeps the existing value and returns it', async () => {
    const store = createMemoryStore();
    await store.put(DATE, challenge('first'));

    const result = await store.putIfAbsent(DATE, challenge('second'));

    expect(result).toEqual(challenge('first'));
    expect(await store.get(DATE)).toEqual(challenge('first'));
  });

  it('putIfAbsent stores when nothing exists', async () => {
    const store = createMemoryStore();

    const result = await store.putIfAbsent(DATE, challenge('first'));

    expect(result).toEqual(challenge('first'));
  });
});

describe('nullStore', () => {
  it('stores nothing, so the app degrades to per-process caching', async () => {
    await nullStore.put(DATE, challenge('ignored'));

    expect(await nullStore.get(DATE)).toBeNull();
  });

  it('returns the challenge it was offered', async () => {
    expect(await nullStore.putIfAbsent(DATE, challenge('x'))).toEqual(challenge('x'));
  });
});
