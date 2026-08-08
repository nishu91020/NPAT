import React, { useState, useEffect } from 'react';
import { DailyPuzzle, UserAnswers, GameResult, GameStats } from './types';
import { getDailyPuzzleData, getRandomPuzzleData, validateAnswersLocally } from './utils/puzzleData';
import { loadGameStats, recordGameCompletion, loadTodayDailyResult } from './utils/storage';
import { playSuccessSound, playFailureSound, playClickSound } from './utils/audio';
import { Header } from './components/Header';
import { LetterBanner } from './components/LetterBanner';
import { CategoryInputForm } from './components/CategoryInputForm';
import { ValidationResultCard } from './components/ValidationResultCard';
import { StreakStatsModal } from './components/StreakStatsModal';
import { HelpRulesModal } from './components/HelpRulesModal';
import { SeoFaqSection } from './components/SeoFaqSection';
import { Sparkles, Trophy, Flame, RefreshCw, Calendar, Share2, HelpCircle } from 'lucide-react';

export default function App() {
  const [mode, setMode] = useState<'daily' | 'practice'>('daily');
  const [puzzle, setPuzzle] = useState<DailyPuzzle>(getDailyPuzzleData());
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [stats, setStats] = useState<GameStats>(loadGameStats());
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [isStatsOpen, setIsStatsOpen] = useState<boolean>(false);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const todayStr = new Date().toISOString().split('T')[0];

  // Load Daily puzzle & initial completed state
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

    // Check if user already played today's official daily puzzle
    const savedResult = loadTodayDailyResult(todayStr);
    if (savedResult) {
      setGameResult(savedResult);
    }
  };

  const fetchPracticePuzzle = async (excludeLetter?: string) => {
    try {
      const res = await fetch(`/api/practice-challenge?exclude=${excludeLetter || ''}`);
      if (res.ok) {
        const data = await res.json();
        setPuzzle(data);
      } else {
        setPuzzle(getRandomPuzzleData(excludeLetter));
      }
    } catch (e) {
      setPuzzle(getRandomPuzzleData(excludeLetter));
    }
  };

  const handleSelectMode = (newMode: 'daily' | 'practice') => {
    setMode(newMode);
    if (newMode === 'daily') {
      fetchDailyPuzzle();
    } else {
      setGameResult(null);
      fetchPracticePuzzle();
    }
  };

  const handleNewPracticeRound = () => {
    setGameResult(null);
    fetchPracticePuzzle(puzzle.letter);
  };

  const handleSubmitAnswers = async (answers: UserAnswers, timeTaken: number, remainingLives: number) => {
    setIsSubmitting(true);
    let validationRes = null;

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

      if (response.ok) {
        validationRes = await response.json();
      } else {
        validationRes = validateAnswersLocally(puzzle.letter, answers, puzzle.bonusChallenge, timeTaken);
      }
    } catch (e) {
      console.error('Validation request failed, using local fallback:', e);
      validationRes = validateAnswersLocally(puzzle.letter, answers, puzzle.bonusChallenge, timeTaken);
    }

    setIsSubmitting(false);

    // Play victory or try again audio feedback
    if (soundEnabled) {
      if (validationRes.totalScore >= 20) {
        playSuccessSound();
      } else {
        playFailureSound();
      }
    }

    const currentStats = loadGameStats();
    let newStreak = currentStats.currentStreak;
    if (mode === 'daily') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      if (currentStats.lastPlayedDate === yesterdayStr || currentStats.lastPlayedDate === null) {
        newStreak += 1;
      } else if (currentStats.lastPlayedDate !== todayStr) {
        newStreak = 1;
      }
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
      mode,
    };

    setGameResult(resultObj);
    const updatedStats = recordGameCompletion(resultObj);
    setStats(updatedStats);
  };

  const hasPlayedTodayOfficial = !!loadTodayDailyResult(todayStr);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col selection:bg-indigo-600 selection:text-white">
      {/* Top Navigation Header */}
      <Header
        streak={stats.currentStreak}
        mode={mode}
        onSelectMode={handleSelectMode}
        onOpenStats={() => setIsStatsOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(!soundEnabled)}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-8">
        {/* Letter & Bonus Challenge Banner */}
        <LetterBanner
          puzzle={puzzle}
          mode={mode}
          onNewPracticeRound={handleNewPracticeRound}
          hasPlayedToday={hasPlayedTodayOfficial}
        />

        {/* Dynamic State Section */}
        {gameResult ? (
          <ValidationResultCard
            result={gameResult}
            onPlayAgain={mode === 'practice' ? handleNewPracticeRound : undefined}
            onViewStats={() => setIsStatsOpen(true)}
            mode={mode}
          />
        ) : (
          <CategoryInputForm
            puzzle={puzzle}
            onSubmit={handleSubmitAnswers}
            isSubmitting={isSubmitting}
            soundEnabled={soundEnabled}
          />
        )}

        {/* SEO & Game Guide Section */}
        <SeoFaqSection />
      </main>

      {/* System Footer Bar - Geometric Balance Aesthetic */}
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

