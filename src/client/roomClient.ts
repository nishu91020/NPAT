import type { RoomView, UserAnswers } from '../shared/contract';

/**
 * A caller's claim to a seat: the id that names it, and the server-issued token
 * that proves it. Ids are public — every player sees them — so the token is what
 * separates a player from anyone who merely read the room.
 */
export interface PlayerSeat {
  playerId: string;
  token: string;
}

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

/**
 * Takes a seat, presenting the token for this room if this browser already holds
 * one — that is what lets a refresh reclaim its seat rather than being refused.
 */
export function joinRoom(
  code: string,
  playerId: string,
  name: string,
  token: string
): Promise<RoomView> {
  return post<RoomView>(`/api/rooms/${encodeURIComponent(code)}/join`, { playerId, name, token });
}

export function fetchRoom(code: string, seat: PlayerSeat): Promise<RoomView> {
  const query = new URLSearchParams({ playerId: seat.playerId, token: seat.token });
  return request<RoomView>(`/api/rooms/${encodeURIComponent(code)}?${query}`);
}

export function startRoomRound(code: string, seat: PlayerSeat): Promise<RoomView> {
  return post<RoomView>(`/api/rooms/${encodeURIComponent(code)}/start`, seat);
}

export function submitRoomAnswers(
  code: string,
  seat: PlayerSeat,
  answers: UserAnswers
): Promise<RoomView> {
  // No time is sent: the server started the round, so it owns the clock.
  return post<RoomView>(`/api/rooms/${encodeURIComponent(code)}/submit`, { ...seat, answers });
}

export function nextRoomRound(code: string, seat: PlayerSeat): Promise<RoomView> {
  return post<RoomView>(`/api/rooms/${encodeURIComponent(code)}/next`, seat);
}

/** Host only, and only before the first round — the server enforces both. */
export function setRoomRounds(
  code: string,
  seat: PlayerSeat,
  totalRounds: number
): Promise<RoomView> {
  return post<RoomView>(`/api/rooms/${encodeURIComponent(code)}/rounds`, { ...seat, totalRounds });
}

export function newRoomMatch(code: string, seat: PlayerSeat): Promise<RoomView> {
  return post<RoomView>(`/api/rooms/${encodeURIComponent(code)}/new-match`, seat);
}

export function leaveRoom(code: string, seat: PlayerSeat): void {
  // Best effort on the way out — the room also drops players who stop polling,
  // so nothing depends on this arriving.
  const body = JSON.stringify(seat);
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

/**
 * Seconds left in the round, measured against the server's clock, never the browser's.
 *
 * Rounded **up** on purpose: zero is what makes every client auto-submit, so it
 * must not arrive before the deadline it is counting down to. Rounding to nearest
 * showed 0 up to half a second early, and the submission then landed as an
 * ordinary on-time answer — the round claimed everyone had finished when in fact
 * the clock had run out.
 */
export function secondsLeft(round: { endsAt: string; serverNow: string }, sinceMs: number): number {
  const remainingAtFetch = new Date(round.endsAt).getTime() - new Date(round.serverNow).getTime();
  return Math.max(0, Math.ceil((remainingAtFetch - sinceMs) / 1000));
}
