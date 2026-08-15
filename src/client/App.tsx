import React, { useState, useEffect } from 'react';
import { DailyPuzzle, UserAnswers, ValidationResponse } from '../shared/contract';
import { GameResult, GameStats } from './types';
import { getDailyPuzzleData } from '../shared/puzzle';
import { loadGameStats, recordGameCompletion, loadTodayDailyResult } from './storage';
import { useRoom } from './useRoom';
import { playSuccessSound, playFailureSound, playClickSound, setMuted } from './audio';
import { Header } from './components/Header';
import { LandingScreen } from './components/LandingScreen';
import { RoomScreen } from './components/RoomScreen';
import { LetterBanner } from './components/LetterBanner';
import { CategoryInputForm } from './components/CategoryInputForm';
import { ValidationResultCard } from './components/ValidationResultCard';
import { StreakStatsModal } from './components/StreakStatsModal';
import { HelpRulesModal } from './components/HelpRulesModal';
import { SeoFaqSection } from './components/SeoFaqSection';
import { AlertCircle, ArrowLeft } from 'lucide-react';

export default function App() {
  const [view, setView] = useState<'landing' | 'game' | 'room'>('landing');
  const [puzzle, setPuzzle] = useState<DailyPuzzle>(getDailyPuzzleData());
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [stats, setStats] = useState<GameStats>(loadGameStats());
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [isStatsOpen, setIsStatsOpen] = useState<boolean>(false);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const rooms = useRoom({ onExited: () => setView('landing') });

  const todayStr = new Date().toISOString().split('T')[0];
  
  useEffect(() => {
    setMuted(!soundEnabled);
  }, [soundEnabled]);

  useEffect(() => {
    fetchDailyPuzzle();
  }, []);

  const fetchDailyPuzzle = async () => {
    try {
      const res = await fetch(`/api/daily-challenge?date=${todayStr}`);
      if (res.ok) {
        const data = await res.json();
        setPuzzle(data);
      } else {
        setPuzzle(getDailyPuzzleData(todayStr));
      }
    } catch (e) {
      setPuzzle(getDailyPuzzleData(todayStr));
    }

    const savedResult = loadTodayDailyResult(todayStr);
    if (savedResult) {
      setGameResult(savedResult);
    }
  };

  const handleGoHome = () => {
    setSubmitError(null);
    rooms.release();
    setView('landing');
  };

  const handleDailyChallenge = () => {
    setSubmitError(null);
    setView('game');
    fetchDailyPuzzle();
  };

  const handleCreateRoom = async (name: string) => {
    if (await rooms.create(name)) setView('room');
  };

  const handleJoinRoom = async (name: string, code: string) => {
    if (await rooms.join(name, code)) setView('room');
  };

  const hasPlayedTodayOfficial = !!loadTodayDailyResult(todayStr);

  const handleSubmitAnswers = async (answers: UserAnswers, timeTaken: number, remainingLives: number) => {
    setIsSubmitting(true);
    setSubmitError(null);

    let validationRes: ValidationResponse;
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

      validationRes = await response.json();
    } catch (e) {
      console.error('Validation request failed:', e);
      setIsSubmitting(false);
      setSubmitError(
        'We could not score this round. Check your connection and submit again — nothing has been recorded.'
      );
      return;
    }

    setIsSubmitting(false);

    if (validationRes.totalScore >= 20) {
      playSuccessSound();
    } else {
      playFailureSound();
    }

    const currentStats = loadGameStats();
    let newStreak = currentStats.currentStreak;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    if (currentStats.lastPlayedDate === yesterdayStr || currentStats.lastPlayedDate === null) {
      newStreak += 1;
    } else if (currentStats.lastPlayedDate !== todayStr) {
      newStreak = 1;
    }

    const resultObj: GameResult = {
      dayNumber: puzzle.dayNumber,
      dateString: puzzle.dateString,
      letter: puzzle.letter,
      answers,
      validation: validationRes,
      score: validationRes.totalScore,
      streak: newStreak,
      timeTaken,
      livesRemaining: remainingLives,
      completedAt: new Date().toISOString(),
    };

    setGameResult(resultObj);
    const updatedStats = recordGameCompletion(resultObj);
    setStats(updatedStats);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col selection:bg-indigo-600 selection:text-white">
      <Header
        streak={stats.currentStreak}
        onGoHome={handleGoHome}
        onOpenStats={() => setIsStatsOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(!soundEnabled)}
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-8">
        {view === 'landing' ? (
          <LandingScreen
            streak={stats.currentStreak}
            dayNumber={puzzle.dayNumber}
            hasPlayedToday={hasPlayedTodayOfficial}
            playerName={rooms.playerName}
            initialCode={rooms.inviteCode}
            isBusy={rooms.isBusy}
            error={rooms.error}
            onDailyChallenge={handleDailyChallenge}
            onCreateRoom={handleCreateRoom}
            onJoinRoom={handleJoinRoom}
            onDismissError={rooms.dismissError}
          />
        ) : view === 'room' && rooms.room ? (
          <RoomScreen
            room={rooms.room}
            fetchedAtMs={rooms.fetchedAtMs}
            error={rooms.error}
            isBusy={rooms.isBusy}
            onStartRound={rooms.startRound}
            onSubmit={rooms.submitAnswers}
            onNextRound={rooms.nextRound}
            onSetRounds={rooms.setRounds}
            onNewMatch={rooms.newMatch}
            onLeave={rooms.leave}
          />
        ) : (
          <>
            <button
              id="back-to-menu-btn"
              onClick={() => {
                playClickSound();
                handleGoHome();
              }}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 bg-white border-2 border-slate-200 hover:border-slate-900 text-slate-700 hover:text-slate-900 font-black text-[10px] uppercase tracking-widest transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to menu</span>
            </button>

            <LetterBanner puzzle={puzzle} hasPlayedToday={hasPlayedTodayOfficial} />

            {gameResult ? (
              <ValidationResultCard
                result={gameResult}
                onViewStats={() => setIsStatsOpen(true)}
              />
            ) : (
              <>
                {submitError && (
                  <div
                    id="submit-error-banner"
                    role="alert"
                    className="p-4 bg-rose-50 border-l-4 border-rose-500 text-rose-900 text-xs font-bold uppercase tracking-wider flex items-center gap-2"
                  >
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{submitError}</span>
                  </div>
                )}
                <CategoryInputForm
                  puzzle={puzzle}
                  onSubmit={handleSubmitAnswers}
                  isSubmitting={isSubmitting}
                />
              </>
            )}
          </>
        )}
        <SeoFaqSection />
      </main>

      <footer className="bg-slate-900 text-slate-400 px-6 sm:px-10 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-[10px] font-black tracking-widest uppercase border-t-2 border-slate-900">
        <div className="flex items-center gap-6">
          <span>LEXICON v1.0.4</span>
          <span className="hidden sm:inline text-slate-600">•</span>
          <span>Name • Place • Animal • Thing</span>
        </div>
        <div className="flex items-center gap-6">
          <button
            onClick={() => {
              playClickSound();
              setIsHelpOpen(true);
            }}
            className="hover:text-white transition-colors"
          >
            Rules
          </button>
          <button
            onClick={() => {
              playClickSound();
              setIsStatsOpen(true);
            }}
            className="hover:text-white transition-colors"
          >
            My Stats ({stats.gamesPlayed})
          </button>
        </div>
      </footer>

      {/* Modals */}
      <StreakStatsModal
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
        stats={stats}
      />

      <HelpRulesModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />
    </div>
  );
}

