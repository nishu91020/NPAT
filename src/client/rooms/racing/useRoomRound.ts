import { useCallback, useEffect, useRef, useState } from 'react';
import type { CategoryKey, RoomView, UserAnswers } from '../../../shared/contract';
import { secondsLeft } from '../client/roomClient';
import { playTickSound } from '../../audio';

const EMPTY_ANSWERS: UserAnswers = { name: '', place: '', animal: '', thing: '' };

export interface RoomRoundController {
  answers: UserAnswers;
  setAnswer: (key: CategoryKey, value: string) => void;
  timeLeft: number;
  youAreRacing: boolean;
  youHaveSubmitted: boolean;
}

export function useRoomRound(
  room: RoomView,
  fetchedAtMs: number,
  onSubmit: (answers: UserAnswers, auto?: boolean) => void
): RoomRoundController {
  const [answers, setAnswers] = useState<UserAnswers>(EMPTY_ANSWERS);
  const [, setNowTick] = useState(0);
  const roundNumber = room.round?.number ?? 0;
  const lastRoundRef = useRef(roundNumber);
  const hasAutoSubmitted = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const you = room.players.find((p) => p.id === room.youId);
  const youHaveSubmitted = Boolean(you?.hasSubmitted);
  const youAreRacing = Boolean(you?.racing);
  const timeLeft = room.round ? secondsLeft(room.round, Date.now() - fetchedAtMs) : 0;

  useEffect(() => {
    if (roundNumber !== lastRoundRef.current) {
      lastRoundRef.current = roundNumber;
      setAnswers(EMPTY_ANSWERS);
      hasAutoSubmitted.current = false;
    }
  }, [roundNumber]);

  useEffect(() => {
    if (room.phase === 'racing' && youAreRacing && !youHaveSubmitted && timeLeft <= 10 && timeLeft > 0) {
      playTickSound();
    }
  }, [timeLeft, room.phase, youAreRacing, youHaveSubmitted]);

  const answersRef = useRef(answers);
  answersRef.current = answers;

  useEffect(() => {
    if (room.phase !== 'racing' || !youAreRacing || youHaveSubmitted) return;
    if (timeLeft > 0 || hasAutoSubmitted.current) return;

    hasAutoSubmitted.current = true;
    onSubmit(answersRef.current, true);
  }, [timeLeft, room.phase, youAreRacing, youHaveSubmitted, roundNumber, onSubmit]);

  const setAnswer = useCallback((key: CategoryKey, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);

  return { answers, setAnswer, timeLeft, youAreRacing, youHaveSubmitted };
}
