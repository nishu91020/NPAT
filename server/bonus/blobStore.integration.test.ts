import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BonusChallenge } from '../../shared/contract';
import { createBlobStore } from './blobStore';
import { DailyChallengeStore } from './store';
import { BonusChallengeSource, cachedPerDate } from './types';

/**
 * Runs against Azurite, which must already be listening. Skipped by default so
 * `npm test` needs no emulator; run `npm run test:integration` to include it.
 *
 * Note Azurite needs --skipApiVersionCheck: the storage SDK speaks a newer API
 * version than the emulator recognises, and rejects the request otherwise.
 */
const CONNECTION = 'UseDevelopmentStorage=true';
const enabled = process.env.RUN_AZURITE_TESTS === 'true';

function challenge(id: string): BonusChallenge {
  return { id, title: id, description: 'd', icon: 'Sparkles', ruleHint: 'r' };
}

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

/** A distinct date per run, so leftovers cannot make a test pass. */
function uniqueDate(): string {
  return `2099-01-${String(Math.floor(Math.random() * 89) + 10)}-${Date.now()}`;
}

describe.skipIf(!enabled)('blob store against Azurite', () => {
  let store: DailyChallengeStore;

  beforeAll(() => {
    store = createBlobStore(CONNECTION, 'daily-challenges-test');
  });

  afterAll(async () => {
    // Nothing to tear down: each test uses its own date.
  });

  it('round-trips a challenge', async () => {
    const date = uniqueDate();
    await store.put(date, challenge('stored'));

    expect(await store.get(date)).toEqual(challenge('stored'));
  });

  it('returns null for a date with no blob', async () => {
    expect(await store.get(uniqueDate())).toBeNull();
  });

  it('putIfAbsent keeps the first value written', async () => {
    const date = uniqueDate();

    const first = await store.putIfAbsent(date, challenge('first'));
    const second = await store.putIfAbsent(date, challenge('second'));

    expect(first).toEqual(challenge('first'));
    expect(second).toEqual(challenge('first'));
  });

  it('gives two replicas the same challenge when one already published', async () => {
    const date = uniqueDate();
    const published = countingSource('replica-a');
    const late = countingSource('replica-b');

    const a = await cachedPerDate(() => published, { store }).forDate(date, 'S');
    const b = await cachedPerDate(() => late, { store }).forDate(date, 'S');

    expect(b).toEqual(a);
    // The second replica read the stored value rather than generating.
    expect(late.calls).toBe(0);
  });

  it('converges when replicas race on an empty store', async () => {
    const date = uniqueDate();

    const [a, b] = await Promise.all([
      cachedPerDate(() => countingSource('replica-a'), { store }).forDate(date, 'S'),
      cachedPerDate(() => countingSource('replica-b'), { store }).forDate(date, 'S'),
    ]);

    expect(a).toEqual(b);
    expect(await store.get(date)).toEqual(a);
  });
});
