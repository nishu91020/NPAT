import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BonusChallenge } from '../../shared/contract';
import { deterministicSourceForDate } from './builtinSource';
import { nullStore, BonusChallengeSource, cachedPerDate, withBonusFallback } from './dailyChallenge';

const uploadMock = vi.fn();
const downloadMock = vi.fn();
const createIfNotExistsMock = vi.fn();
const getBlockBlobClientMock = vi.fn(() => ({
  upload: uploadMock,
  download: downloadMock,
}));

vi.mock('@azure/storage-blob', () => {
  class RestError extends Error {
    statusCode: number;

    constructor(statusCode: number) {
      super(`status ${statusCode}`);
      this.statusCode = statusCode;
      this.name = 'RestError';
    }
  }

  return {
    RestError,
    BlobServiceClient: {
      fromConnectionString: vi.fn(() => ({
        getContainerClient: vi.fn(() => ({
          createIfNotExists: createIfNotExistsMock,
          getBlockBlobClient: getBlockBlobClientMock,
        })),
      })),
    },
  };
});

const { createBlobStore } = await import('./blobStore');

function challenge(id: string): BonusChallenge {
  return { id, title: id, description: id, icon: 'Sparkles', ruleHint: id };
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

const DATE = '2026-08-08';

beforeEach(() => {
  vi.clearAllMocks();
  createIfNotExistsMock.mockResolvedValue(undefined);
  uploadMock.mockResolvedValue(undefined);
});

describe('blob store', () => {
  it('returns null when the blob is missing', async () => {
    const { RestError } = await import('@azure/storage-blob');
    downloadMock.mockRejectedValue(new RestError(404));

    const store = createBlobStore('UseDevelopmentStorage=true');

    await expect(store.get('2026-08-10')).resolves.toBeNull();
  });

  it('keeps the stored value when a concurrent writer wins putIfAbsent', async () => {
    const { RestError } = await import('@azure/storage-blob');
    const existing = challenge('existing');

    uploadMock.mockRejectedValue(new RestError(409));
    downloadMock.mockResolvedValue({
      readableStreamBody: Readable.from([JSON.stringify(existing)]),
    });

    const store = createBlobStore('UseDevelopmentStorage=true');

    await expect(store.putIfAbsent('2026-08-11', challenge('new'))).resolves.toEqual(existing);
  });
});

describe('cachedPerDate with no shared store', () => {
  it('falls back to per-process caching when no store is configured', async () => {
    const source = countingSource('replica-a');
    const daily = cachedPerDate(() => source, { store: nullStore });

    const a = await daily.forDate(DATE, 'S');
    const b = await daily.forDate(DATE, 'S');

    expect(b).toEqual(a);
    expect(source.calls).toBe(1);
  });
});

describe('cachedPerDate behavior', () => {
  it('generates once per date in process memory', async () => {
    const source = countingSource('replica-a');
    const daily = cachedPerDate(() => source, { store: nullStore });

    const first = await daily.forDate(DATE, 'S');
    const second = await daily.forDate(DATE, 'S');

    expect(second).toEqual(first);
    expect(source.calls).toBe(1);
  });

  it('keeps dates independent', async () => {
    const source = countingSource('replica-a');
    const daily = cachedPerDate(() => source, { store: nullStore });

    const first = await daily.forDate('2026-08-08', 'S');
    const second = await daily.forDate('2026-08-09', 'T');

    expect(second).not.toEqual(first);
    expect(source.calls).toBe(2);
  });

  it('does not cache a failure, so the day is not poisoned until restart', async () => {
    let attempt = 0;
    const flaky: BonusChallengeSource = {
      async next() {
        attempt++;
        if (attempt === 1) throw new Error('generation failed');
        return challenge('recovered');
      },
    };

    const daily = cachedPerDate(() => flaky, { store: nullStore });

    await expect(daily.forDate(DATE, 'S')).rejects.toThrow('generation failed');
    await expect(daily.forDate(DATE, 'S')).resolves.toEqual(challenge('recovered'));
  });
});

describe('cachedPerDate', () => {
  it('generates once per date, so every player sees the same bonus', async () => {
    const source = countingSource('daily');
    const daily = cachedPerDate(() => source, { store: nullStore });

    const first = await daily.forDate('2026-08-08', 'S');
    const second = await daily.forDate('2026-08-08', 'S');
    const third = await daily.forDate('2026-08-08', 'S');

    expect(source.calls).toBe(1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('generates separately for a different date', async () => {
    const source = countingSource('daily');
    const daily = cachedPerDate(() => source, { store: nullStore });

    await daily.forDate('2026-08-08', 'S');
    await daily.forDate('2026-08-09', 'T');

    expect(source.calls).toBe(2);
  });

  it('shares one in-flight generation between concurrent callers', async () => {
    const source = countingSource('daily');
    const daily = cachedPerDate(() => source, { store: nullStore });

    const [a, b] = await Promise.all([
      daily.forDate('2026-08-08', 'S'),
      daily.forDate('2026-08-08', 'S'),
    ]);

    expect(source.calls).toBe(1);
    expect(a).toEqual(b);
  });

  it('evicts old dates rather than growing without bound', async () => {
    const source = countingSource('daily');
    const daily = cachedPerDate(() => source, { store: nullStore, maxDays: 2 });

    await daily.forDate('2026-08-01', 'A');
    await daily.forDate('2026-08-02', 'B');
    await daily.forDate('2026-08-03', 'C');

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

describe('nullStore', () => {
  it('stores nothing, so the app degrades to per-process caching', async () => {
    await nullStore.put(DATE, challenge('ignored'));

    expect(await nullStore.get(DATE)).toBeNull();
  });

  it('returns the challenge it was offered', async () => {
    expect(await nullStore.putIfAbsent(DATE, challenge('x'))).toEqual(challenge('x'));
  });
});
