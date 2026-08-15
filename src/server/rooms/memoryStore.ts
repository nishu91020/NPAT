import { RoomVersionConflict, type Room, type RoomStore, type StoredRoom } from './types';

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
