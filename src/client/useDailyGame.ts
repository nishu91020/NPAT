import { useEffect, useRef, useState } from 'react';
import type { DailyPuzzle, UserAnswers, ValidationResponse } from '../shared/contract';
import type { GameResult } from './types';
import { getDailyPuzzleData } from '../shared/puzzle';
import { loadGameStats, loadTodayDailyResult } from './storage';
import { playFailureSound, playSuccessSound } from './audio';

const WIN_SCORE = 20;

const SUBMIT_ERROR =
  'We could not score this round. Check your connection and submit again — nothing has been recorded.';

export interface DailyGameController {
  puzzle: DailyPuzzle;
  result: GameResult | null;
  hasPlayedToday: boolean;
  isSubmitting: boolean;
  error: string | null;
  start: () => void;
  submit: (answers: UserAnswers, timeTaken: number, remainingLives: number) => Promise<void>;
  dismissError: () => void;
}

interface UseDailyGameOptions {

  onStarted: () => void;
  onCompleted: (result: GameResult) => void;
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function yesterday(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
}

function nextStreak(dateStr: string): number {
  const stats = loadGameStats();
  if (stats.lastPlayedDate === yesterday() || stats.lastPlayedDate === null) {
    return stats.currentStreak + 1;
  }
  return stats.lastPlayedDate === dateStr ? stats.currentStreak : 1;
}

export function useDailyGame({ onStarted, onCompleted }: UseDailyGameOptions): DailyGameController {
  const [puzzle, setPuzzle] = useState<DailyPuzzle>(getDailyPuzzleData);
  const [result, setResult] = useState<GameResult | null>(() => loadTodayDailyResult(today()));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const started = useRef(onStarted);
  started.current = onStarted;

  const completed = useRef(onCompleted);
  completed.current = onCompleted;

  const refresh = async () => {
    const dateStr = today();
    try {
      const res = await fetch(`/api/daily-challenge?date=${dateStr}`);
      setPuzzle(res.ok ? await res.json() : getDailyPuzzleData(dateStr));
    } catch {
      setPuzzle(getDailyPuzzleData(dateStr));
    }

    const savedResult = loadTodayDailyResult(dateStr);
    if (savedResult) setResult(savedResult);
  };

  useEffect(() => {
    refresh();
  }, []);

  const submit = async (answers: UserAnswers, timeTaken: number, remainingLives: number) => {
    setIsSubmitting(true);
    setError(null);

    let validation: ValidationResponse;
    try {
      const response = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          letter: puzzle.letter,
          answers,
          bonusChallenge: puzzle.bonusChallenge,
          timeTakenSeconds: timeTaken,
        }),
      });

      if (!response.ok) {
        throw new Error(`Validation failed with status ${response.status}`);
      }

      validation = await response.json();
    } catch (e) {
      console.error('Validation request failed:', e);
      setIsSubmitting(false);
      setError(SUBMIT_ERROR);
      return;
    }

    setIsSubmitting(false);

    if (validation.totalScore >= WIN_SCORE) {
      playSuccessSound();
    } else {
      playFailureSound();
    }

    const round: GameResult = {
      dayNumber: puzzle.dayNumber,
      dateString: puzzle.dateString,
      letter: puzzle.letter,
      answers,
      validation,
      score: validation.totalScore,
      streak: nextStreak(today()),
      timeTaken,
      livesRemaining: remainingLives,
      completedAt: new Date().toISOString(),
    };

    setResult(round);
    completed.current(round);
  };

  return {
    puzzle,
    result,
    hasPlayedToday: result !== null,
    isSubmitting,
    error,

    start() {
      setError(null);
      started.current();
      refresh();
    },

    submit,
    dismissError: () => setError(null),
  };
}
