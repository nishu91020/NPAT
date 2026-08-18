import { beforeAll, describe, expect, it } from 'vitest';
import { createBlobRoomStore } from './blobStore';
import { createRoom } from './roomState';
import { RoomVersionConflict, type RoomStore } from './types';

const CONNECTION = 'UseDevelopmentStorage=true';
const enabled = process.env.RUN_AZURITE_TESTS === 'true';

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

  it('refuses a write built on a read that has since gone stale', async () => {
    const code = uniqueCode();
    await store.create(createRoom(code, 1_000_000));

    const mine = await store.get(code);
    const theirs = await store.get(code);

    theirs!.room.phase = 'racing';
    await store.put(theirs!);

    mine!.room.phase = 'reveal';
    await expect(store.put(mine!)).rejects.toThrow(RoomVersionConflict);

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
