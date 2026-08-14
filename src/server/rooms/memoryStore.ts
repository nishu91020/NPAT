import { RoomVersionConflict, type Room, type RoomStore, type StoredRoom } from './types';

/**
 * In-memory rooms.
 *
 * ⚠️ Correct for exactly one replica. This app runs at `maxReplicas: 5`, so two
 * players in one room can be served by different processes and would then see
 * two different rooms — the same class of bug the daily challenge had before
 * `DailyChallengeStore` existed. It is also erased by a restart, and the app
 * scales to zero. `main.ts` only builds this one when the deployment has said,
 * in as many words, that it runs a single replica.
 *
 * It still enforces versions, and it stores a *copy* rather than the caller's
 * object. Handing the live object back would let a caller mutate the store
 * without saving — aliasing a shared adapter cannot reproduce, and the test
 * substitute has to catch what production would catch.
 */
export function createMemoryRoomStore(): RoomStore {
  const rooms = new Map<string, { room: Room; version: string }>();
  let sequence = 0;

  const nextVersion = () => `v${++sequence}`;
  const copy = (room: Room): Room => structuredClone(room);

  return {
    async create(room) {
      if (rooms.has(room.code)) throw new RoomVersionConflict(room.code);
      rooms.set(room.code, { room: copy(room), version: nextVersion() });
    },

    async get(code): Promise<StoredRoom | null> {
      const entry = rooms.get(code);
      return entry ? { room: copy(entry.room), version: entry.version } : null;
    },

    async put({ room, version }) {
      const entry = rooms.get(room.code);
      // A null version means "this must not exist yet"; anything else has to match
      // the version the caller read, or another writer got there first.
      if (entry ? entry.version !== version : version !== null) {
        throw new RoomVersionConflict(room.code);
      }
      rooms.set(room.code, { room: copy(room), version: nextVersion() });
    },

    async delete(code) {
      rooms.delete(code);
    },
  };
}
