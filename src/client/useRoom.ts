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

/**
 * Everything about being in a room: the seat, the poll, and the actions.
 *
 * It lives apart from `App` because none of it is the daily game — the identity,
 * the seat token, the staleness epoch and the polling loop are only meaningful
 * while a room is held, and threading them through the component that also owns
 * the puzzle made both harder to follow.
 */
export interface RoomController {
  room: RoomView | null;
  /** When `room` was received, so a countdown runs off the server's clock. */
  fetchedAtMs: number;
  error: string | null;
  isBusy: boolean;
  playerName: string;
  /** From an invite link (`/?room=CODE`), so a guest only types their name. */
  inviteCode: string;
  create: (name: string) => Promise<boolean>;
  join: (name: string, code: string) => Promise<boolean>;
  startRound: () => Promise<void>;
  submitAnswers: (answers: UserAnswers, auto?: boolean) => Promise<void>;
  setRounds: (totalRounds: number) => Promise<void>;
  newMatch: () => Promise<void>;
  nextRound: () => Promise<void>;
  /** Leaves and forgets the invite link, for a player who chose to walk away. */
  leave: () => void;
  /** Gives up the seat without any navigation of its own. */
  release: () => void;
  dismissError: () => void;
}

interface UseRoomOptions {
  /** The seat is gone — the room closed under us, or was lost to someone else. */
  onExited: () => void;
}

function describeError(err: unknown): string {
  return err instanceof RoomRequestError ? err.message : 'Something went wrong. Try again.';
}

export function useRoom({ onExited }: UseRoomOptions): RoomController {
  const [player, setPlayer] = useState(loadPlayerIdentity);
  // Held together because they are read together: a countdown measured against
  // a timestamp from a different poll than the room it belongs to is wrong.
  const [snapshot, setSnapshot] = useState<{ room: RoomView | null; fetchedAtMs: number }>({
    room: null,
    fetchedAtMs: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  /**
   * Which seat this browser is on its way to, bumped every time it gives one up.
   *
   * ⚠️ Leaving a room does not cancel the requests already in flight for it — the
   * poll in particular is fired every 1.5s and answers whenever the network gets
   * round to it. Applying those replies unconditionally put the player back into
   * the room they had just left: create a room, leave without playing, create
   * another, and the in-flight poll for the first one landed a moment later and
   * replaced it. The second room was made — the player just never got to see it,
   * which reads as "I cannot create another room".
   */
  const epoch = useRef(0);
  /**
   * The token proving this browser owns its seat, issued by the server when the
   * seat was taken and required by every request that acts on the room.
   *
   * A ref rather than state because every call reads it and none should re-run
   * when it changes; mirrored into `localStorage` so a refresh can reclaim the
   * seat instead of being refused as an impostor.
   */
  const token = useRef('');

  // Held in a ref so the poll can call the latest one without re-arming itself
  // every time the caller re-renders.
  const exited = useRef(onExited);
  exited.current = onExited;

  const [inviteCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    return (new URLSearchParams(window.location.search).get('room') ?? '').toUpperCase();
  });

  const seat = (): PlayerSeat => ({ playerId: player.id, token: token.current });

  const apply = (next: RoomView) => {
    // Only create and join carry a token, and only to the caller they issued it
    // to. Every other reply leaves the one already held alone.
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

  /**
   * One request, start to finish — and ignored entirely if the player has left
   * that room by the time it answers.
   */
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

  /** Only meaningful while a seat is held, so it is also what arms the poll. */
  const code = snapshot.room?.code;

  useEffect(() => {
    if (!code) return;
    const at = epoch.current;

    const id = window.setInterval(async () => {
      try {
        // Read per poll, never captured: the token arrives with the reply that
        // created or joined the room, which may land after this was armed.
        const next = await fetchRoom(code, { playerId: player.id, token: token.current });
        if (at !== epoch.current) return;
        setSnapshot({ room: next, fetchedAtMs: Date.now() });
      } catch (err) {
        if (at !== epoch.current) return;
        // A room that has closed under us is worth surfacing; a blip is not. So
        // is a seat we no longer hold — polling on would never recover it.
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
      // One room at a time: whatever seat this browser still holds is given up
      // before a new one is taken, so an abandoned room cannot follow the player
      // into the one they are creating.
      release();
      setError(null);
      return run(() => createRoom(identity.id, name));
    },

    async join(name, roomCode) {
      // ⚠️ Read before giving up the current seat: `release` clears the stored
      // one, and a refresh mid-room is exactly a join with the token that proves
      // the seat is already yours. Reading it afterwards always found nothing,
      // and the server rightly refused the seat to a player who could not prove
      // it.
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

    // An auto-submit races the server ending the round; losing that race is
    // normal and the server has already taken the answers as blank, so saying so
    // would only be noise.
    submitAnswers: (answers, auto = false) =>
      act((room) => submitRoomAnswers(room.code, seat(), answers), auto),

    leave() {
      release();
      setError(null);
      exited.current();
      // Drop the invite parameter so a refresh does not rejoin what was left.
      if (typeof window !== 'undefined' && window.location.search.includes('room=')) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    },

    release,
    dismissError: () => setError(null),
  };
}
