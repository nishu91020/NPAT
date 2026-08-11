import type { RoomView, UserAnswers } from '../shared/contract';

/**
 * Talking to a room.
 *
 * Polling, not sockets. It is the only transport that survives this app running
 * on several replicas without a message backplane, because the room in the store
 * is already the source of truth — and it is what the transport research
 * recommended for a first version. See
 * .scratch/multiplayer-rooms/research/03-realtime-transport.md.
 */

export const ROOM_POLL_MS = 1500;

export class RoomRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'RoomRequestError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new RoomRequestError('Could not reach the server. Check your connection.', 0);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new RoomRequestError(body?.error ?? 'That did not work.', response.status);
  }
  return body as T;
}

function post<T>(url: string, payload: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function createRoom(playerId: string, name: string): Promise<RoomView> {
  return post<RoomView>('/api/rooms', { playerId, name });
}

export function joinRoom(code: string, playerId: string, name: string): Promise<RoomView> {
  return post<RoomView>(`/api/rooms/${encodeURIComponent(code)}/join`, { playerId, name });
}

export function fetchRoom(code: string, playerId: string): Promise<RoomView> {
  const query = new URLSearchParams({ playerId });
  return request<RoomView>(`/api/rooms/${encodeURIComponent(code)}?${query}`);
}

export function startRoomRound(code: string, playerId: string): Promise<RoomView> {
  return post<RoomView>(`/api/rooms/${encodeURIComponent(code)}/start`, { playerId });
}

export function submitRoomAnswers(
  code: string,
  playerId: string,
  answers: UserAnswers
): Promise<RoomView> {
  // No time is sent: the server started the round, so it owns the clock.
  return post<RoomView>(`/api/rooms/${encodeURIComponent(code)}/submit`, { playerId, answers });
}

export function nextRoomRound(code: string, playerId: string): Promise<RoomView> {
  return post<RoomView>(`/api/rooms/${encodeURIComponent(code)}/next`, { playerId });
}

export function leaveRoom(code: string, playerId: string): void {
  // Best effort on the way out — the room also drops players who stop polling,
  // so nothing depends on this arriving.
  const body = JSON.stringify({ playerId });
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon(
      `/api/rooms/${encodeURIComponent(code)}/leave`,
      new Blob([body], { type: 'application/json' })
    );
    return;
  }
  void fetch(`/api/rooms/${encodeURIComponent(code)}/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

/** Seconds left in the round, measured against the server's clock, never the browser's. */
export function secondsLeft(round: { endsAt: string; serverNow: string }, sinceMs: number): number {
  const remainingAtFetch = new Date(round.endsAt).getTime() - new Date(round.serverNow).getTime();
  return Math.max(0, Math.round((remainingAtFetch - sinceMs) / 1000));
}
