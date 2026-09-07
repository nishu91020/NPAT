import type { RoomView, UserAnswers } from '../../../shared/contract';

export interface PlayerSeat {
  playerId: string;
  token: string;
}

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

  return post<RoomView>(`/api/rooms/${encodeURIComponent(code)}/submit`, { ...seat, answers });
}

export function nextRoomRound(code: string, seat: PlayerSeat): Promise<RoomView> {
  return post<RoomView>(`/api/rooms/${encodeURIComponent(code)}/next`, seat);
}

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

export function secondsLeft(round: { endsAt: string; serverNow: string }, sinceMs: number): number {
  const remainingAtFetch = new Date(round.endsAt).getTime() - new Date(round.serverNow).getTime();
  return Math.max(0, Math.ceil((remainingAtFetch - sinceMs) / 1000));
}
