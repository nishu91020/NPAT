import { useEffect, useRef, useState } from 'react';
import type { RoomView, UserAnswers } from '../shared/contract';
import {
  ROOM_POLL_MS,
  RoomRequestError,
  createRoom,
  fetchRoom,
  joinRoom,
  leaveRoom,
  newRoomMatch,
  nextRoomRound,
  setRoomRounds,
  startRoomRound,
  submitRoomAnswers,
  type PlayerSeat,
} from './roomClient';
import {
  clearRoomSeat,
  loadPlayerIdentity,
  loadRoomSeat,
  savePlayerIdentity,
  saveRoomSeat,
} from './storage';

export interface RoomController {
  room: RoomView | null;

  fetchedAtMs: number;
  error: string | null;
  isBusy: boolean;
  playerName: string;

  inviteCode: string;
  create: (name: string) => Promise<boolean>;
  join: (name: string, code: string) => Promise<boolean>;
  startRound: () => Promise<void>;
  submitAnswers: (answers: UserAnswers, auto?: boolean) => Promise<void>;
  setRounds: (totalRounds: number) => Promise<void>;
  newMatch: () => Promise<void>;
  nextRound: () => Promise<void>;

  leave: () => void;

  release: () => void;
  dismissError: () => void;
}

interface UseRoomOptions {

  onExited: () => void;
}

function describeError(err: unknown): string {
  return err instanceof RoomRequestError ? err.message : 'Something went wrong. Try again.';
}

export function useRoom({ onExited }: UseRoomOptions): RoomController {
  const [player, setPlayer] = useState(loadPlayerIdentity);

  const [snapshot, setSnapshot] = useState<{ room: RoomView | null; fetchedAtMs: number }>({
    room: null,
    fetchedAtMs: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const epoch = useRef(0);

  const token = useRef('');

  const exited = useRef(onExited);
  exited.current = onExited;

  const [inviteCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    return (new URLSearchParams(window.location.search).get('room') ?? '').toUpperCase();
  });

  const seat = (): PlayerSeat => ({ playerId: player.id, token: token.current });

  const apply = (next: RoomView) => {

    if (next.youToken) {
      token.current = next.youToken;
      saveRoomSeat({ code: next.code, token: next.youToken });
    }
    setSnapshot({ room: next, fetchedAtMs: Date.now() });
    setError(null);
  };

  const forgetSeat = () => {
    token.current = '';
    clearRoomSeat();
    setSnapshot({ room: null, fetchedAtMs: 0 });
  };

  const release = () => {
    epoch.current += 1;
    if (snapshot.room) leaveRoom(snapshot.room.code, seat());
    forgetSeat();
  };

  const run = async (
    work: () => Promise<RoomView>,
    { silent = false }: { silent?: boolean } = {}
  ): Promise<boolean> => {
    const at = epoch.current;
    setIsBusy(true);
    try {
      const next = await work();
      if (at !== epoch.current) return false;
      apply(next);
      return true;
    } catch (err) {
      if (at !== epoch.current) return false;
      if (!silent) setError(describeError(err));
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const rememberName = (name: string) => {
    const identity = { ...player, name };
    setPlayer(identity);
    savePlayerIdentity(identity);
    return identity;
  };

  const code = snapshot.room?.code;

  useEffect(() => {
    if (!code) return;
    const at = epoch.current;

    const id = window.setInterval(async () => {
      try {

        const next = await fetchRoom(code, { playerId: player.id, token: token.current });
        if (at !== epoch.current) return;
        setSnapshot({ room: next, fetchedAtMs: Date.now() });
      } catch (err) {
        if (at !== epoch.current) return;

        if (err instanceof RoomRequestError && (err.status === 404 || err.status === 403)) {
          setError(err.status === 403 ? 'You are no longer in that room.' : 'That room has closed.');
          forgetSeat();
          exited.current();
        }
      }
    }, ROOM_POLL_MS);

    return () => window.clearInterval(id);
  }, [code, player.id]);

  const act = async (
    work: (room: RoomView) => Promise<RoomView>,
    silent = false
  ): Promise<void> => {
    const current = snapshot.room;
    if (!current) return;
    await run(() => work(current), { silent });
  };

  return {
    room: snapshot.room,
    fetchedAtMs: snapshot.fetchedAtMs,
    error,
    isBusy,
    playerName: player.name,
    inviteCode,

    async create(name) {
      const identity = rememberName(name);

      release();
      setError(null);
      return run(() => createRoom(identity.id, name));
    },

    async join(name, roomCode) {

      const held = loadRoomSeat(roomCode);
      const identity = rememberName(name);
      release();
      setError(null);
      return run(() => joinRoom(roomCode, identity.id, name, held));
    },

    startRound: () => act((room) => startRoomRound(room.code, seat())),
    setRounds: (totalRounds) => act((room) => setRoomRounds(room.code, seat(), totalRounds)),
    newMatch: () => act((room) => newRoomMatch(room.code, seat())),
    nextRound: () => act((room) => nextRoomRound(room.code, seat())),

    submitAnswers: (answers, auto = false) =>
      act((room) => submitRoomAnswers(room.code, seat(), answers), auto),

    leave() {
      release();
      setError(null);
      exited.current();

      if (typeof window !== 'undefined' && window.location.search.includes('room=')) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    },

    release,
    dismissError: () => setError(null),
  };
}
