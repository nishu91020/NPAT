import { beforeAll, describe, expect, it } from 'vitest';
import { createBlobRoomStore } from './blobStore';
import { createRoom } from './roomState';
import { RoomVersionConflict, type RoomStore } from './types';

/**
 * Runs against Azurite, which must already be listening. Skipped by default so
 * `npm test` needs no emulator; run `npm run test:integration` to include it.
 *
 * Note Azurite needs --skipApiVersionCheck: the storage SDK speaks a newer API
 * version than the emulator recognises, and rejects the request otherwise.
 *
 * What is being checked here is not that a room round-trips — the memory store
 * proves that — but that ETag compare-and-swap behaves the way the service is
 * written to assume. A room is read-modify-written on every poll, so if the real
 * adapter accepted a stale write, replicas would quietly erase each other.
 */
const CONNECTION = 'UseDevelopmentStorage=true';
const enabled = process.env.RUN_AZURITE_TESTS === 'true';

/** A distinct code per run, so leftovers cannot make a test pass. */
function uniqueCode(): string {
  return `T${Date.now().toString(36).slice(-3).toUpperCase()}${Math.floor(Math.random() * 90) + 10}`;
}

describe.skipIf(!enabled)('blob room store against Azurite', () => {
  let store: RoomStore;

  beforeAll(() => {
    store = createBlobRoomStore(CONNECTION, 'rooms-test');
  });

  it('round-trips a room, version and all', async () => {
    const code = uniqueCode();
    await store.create(createRoom(code, 1_000_000));

    const stored = await store.get(code);

    expect(stored?.room.code).toBe(code);
    expect(stored?.room.phase).toBe('lobby');
    expect(stored?.version).toBeTruthy();

    await store.delete(code);
  });

  it('returns null for a room that does not exist', async () => {
    expect(await store.get(uniqueCode())).toBeNull();
  });

  it('refuses to create a code that is already taken', async () => {
    const code = uniqueCode();
    await store.create(createRoom(code, 1_000_000));

    await expect(store.create(createRoom(code, 1_000_000))).rejects.toThrow(RoomVersionConflict);

    await store.delete(code);
  });

  // ⚠️ The guarantee the whole shared design rests on.
  it('refuses a write built on a read that has since gone stale', async () => {
    const code = uniqueCode();
    await store.create(createRoom(code, 1_000_000));

    const mine = await store.get(code);
    const theirs = await store.get(code);

    theirs!.room.phase = 'racing';
    await store.put(theirs!);

    mine!.room.phase = 'reveal';
    await expect(store.put(mine!)).rejects.toThrow(RoomVersionConflict);

    // The winner's value is the one that survived.
    expect((await store.get(code))!.room.phase).toBe('racing');

    await store.delete(code);
  });

  it('accepts a write made against the version it was just given', async () => {
    const code = uniqueCode();
    await store.create(createRoom(code, 1_000_000));

    for (let i = 0; i < 3; i++) {
      const stored = await store.get(code);
      stored!.room.roundsPlayed = i + 1;
      await store.put(stored!);
    }

    expect((await store.get(code))!.room.roundsPlayed).toBe(3);

    await store.delete(code);
  });

  it('forgets a deleted room', async () => {
    const code = uniqueCode();
    await store.create(createRoom(code, 1_000_000));
    await store.delete(code);

    expect(await store.get(code)).toBeNull();
  });
});
