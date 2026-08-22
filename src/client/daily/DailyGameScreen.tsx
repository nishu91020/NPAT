import React from 'react';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import type { DailyPuzzle, UserAnswers } from '../../shared/contract';
import type { GameResult } from '../types';
import { playClickSound } from '../audio';
import { LetterBanner } from './LetterBanner';
import { CategoryInputForm } from './CategoryInputForm';
import { ValidationResultCard } from './ValidationResultCard';

interface DailyGameScreenProps {
  puzzle: DailyPuzzle;
  result: GameResult | null;
  hasPlayedToday: boolean;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (answers: UserAnswers, timeTaken: number, remainingLives: number) => void;
  onBack: () => void;
  onViewStats: () => void;
}

export const DailyGameScreen: React.FC<DailyGameScreenProps> = ({
  puzzle,
  result,
  hasPlayedToday,
  isSubmitting,
  error,
  onSubmit,
  onBack,
  onViewStats,
}) => (
  <>
    <button
      id="back-to-menu-btn"
      onClick={() => {
        playClickSound();
        onBack();
      }}
      className="btn-outline btn-outline--filled daily-screen__back"
    >
      <ArrowLeft />
      <span>Back to menu</span>
    </button>

    <LetterBanner puzzle={puzzle} hasPlayedToday={hasPlayedToday} />

    {result ? (
      <ValidationResultCard result={result} onViewStats={onViewStats} />
    ) : (
      <>
        {error && (
          <div id="submit-error-banner" role="alert" className="alert alert--error">
            <AlertCircle />
            <span>{error}</span>
          </div>
        )}
        <CategoryInputForm puzzle={puzzle} onSubmit={onSubmit} isSubmitting={isSubmitting} />
      </>
    )}
  </>
);
