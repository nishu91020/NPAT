import type { Room, RoomStore } from './types';

/**
 * In-memory rooms.
 *
 * ⚠️ Correct for exactly one replica. This app runs at `maxReplicas: 5`, so two
 * players in one room can be served by different processes and would then see
 * two different rooms — the same class of bug the daily challenge had before
 * `DailyChallengeStore` existed.
 *
 * It is the adapter shipped first because it needs no infrastructure, and the
 * `RoomStore` port means replacing it with a blob-backed store (the recommendation
 * in .scratch/multiplayer-rooms/research/02-room-state-options.md) touches no
 * caller. Until then, run rooms on a single replica.
 */
export function createMemoryRoomStore(): RoomStore {
  const rooms = new Map<string, Room>();

  return {
    async create(room) {
      if (rooms.has(room.code)) throw new Error(`Room ${room.code} already exists`);
      rooms.set(room.code, room);
    },
    async get(code) {
      return rooms.get(code) ?? null;
    },
    async put(room) {
      rooms.set(room.code, room);
    },
    async delete(code) {
      rooms.delete(code);
    },
  };
}
