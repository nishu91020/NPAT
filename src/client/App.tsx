import React, { useState, useEffect, useRef } from 'react';
import { DailyPuzzle, UserAnswers, ValidationResponse, RoomView } from '../shared/contract';
import { GameResult, GameStats } from './types';
import { getDailyPuzzleData, getRandomPuzzleData } from '../shared/puzzle';
import {
  loadGameStats,
  recordGameCompletion,
  loadTodayDailyResult,
  loadPlayerIdentity,
  savePlayerIdentity,
} from './storage';
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
} from './roomClient';
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
import { Sparkles, Trophy, Flame, RefreshCw, Calendar, Share2, HelpCircle, AlertCircle, ArrowLeft } from 'lucide-react';

export default function App() {
  // The front door. 'landing' offers the three ways in; 'game' is a solo round;
  // 'room' is a live race against other people.
  const [view, setView] = useState<'landing' | 'game' | 'room'>('landing');
  const [mode, setMode] = useState<'daily' | 'practice'>('daily');
  const [puzzle, setPuzzle] = useState<DailyPuzzle>(getDailyPuzzleData());
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [stats, setStats] = useState<GameStats>(loadGameStats());
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [isStatsOpen, setIsStatsOpen] = useState<boolean>(false);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // --- rooms ---------------------------------------------------------------
  const [player, setPlayer] = useState(loadPlayerIdentity);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomBusy, setRoomBusy] = useState<boolean>(false);
  /** When `room` was received, so the countdown runs off the server's clock. */
  const roomFetchedAt = useRef<number>(0);
  // An invite link (/?room=CODE) prefills the join form.
  const [inviteCode] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return (new URLSearchParams(window.location.search).get('room') ?? '').toUpperCase();
  });

  const todayStr = new Date().toISOString().split('T')[0];

  // The audio module owns the gate, so a new call site cannot forget it.
  useEffect(() => {
    setMuted(!soundEnabled);
  }, [soundEnabled]);

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
    setSubmitError(null);
    // Choosing a mode from the header is also a request to start playing it.
    setView('game');
    if (newMode === 'daily') {
      fetchDailyPuzzle();
    } else {
      setGameResult(null);
      fetchPracticePuzzle();
    }
  };

  const handleGoHome = () => {
    setSubmitError(null);
    setView('landing');
  };

  const handleDailyChallenge = () => {
    setSubmitError(null);
    setMode('daily');
    setView('game');
    fetchDailyPuzzle();
  };

  // Rooms: create, join, poll, play, leave.
  const applyRoom = (next: RoomView) => {
    roomFetchedAt.current = Date.now();
    setRoom(next);
    setRoomError(null);
  };

  const describeRoomError = (err: unknown): string =>
    err instanceof RoomRequestError ? err.message : 'Something went wrong. Try again.';

  const rememberName = (name: string) => {
    const identity = { ...player, name };
    setPlayer(identity);
    savePlayerIdentity(identity);
    return identity;
  };

  const handleCreateRoom = async (name: string) => {
    setRoomBusy(true);
    setRoomError(null);
    try {
      const identity = rememberName(name);
      applyRoom(await createRoom(identity.id, name));
      setView('room');
    } catch (err) {
      setRoomError(describeRoomError(err));
    } finally {
      setRoomBusy(false);
    }
  };

  const handleJoinRoom = async (name: string, code: string) => {
    setRoomBusy(true);
    setRoomError(null);
    try {
      const identity = rememberName(name);
      applyRoom(await joinRoom(code, identity.id, name));
      setView('room');
    } catch (err) {
      setRoomError(describeRoomError(err));
    } finally {
      setRoomBusy(false);
    }
  };

  const handleStartRoomRound = async () => {
    if (!room) return;
    setRoomBusy(true);
    try {
      applyRoom(await startRoomRound(room.code, player.id));
    } catch (err) {
      setRoomError(describeRoomError(err));
    } finally {
      setRoomBusy(false);
    }
  };

  const handleRoomSubmit = async (answers: UserAnswers, auto = false) => {
    if (!room) return;
    setRoomBusy(true);
    try {
      applyRoom(await submitRoomAnswers(room.code, player.id, answers));
    } catch (err) {
      // An auto-submit races the server ending the round; losing that race is
      // normal and the server has already taken the player's answers as blank.
      // Telling them off for it would only be noise.
      if (!auto) setRoomError(describeRoomError(err));
    } finally {
      setRoomBusy(false);
    }
  };

  const handleSetRoomRounds = async (totalRounds: number) => {
    if (!room) return;
    setRoomBusy(true);
    try {
      applyRoom(await setRoomRounds(room.code, player.id, totalRounds));
    } catch (err) {
      setRoomError(describeRoomError(err));
    } finally {
      setRoomBusy(false);
    }
  };

  const handleNewRoomMatch = async () => {
    if (!room) return;
    setRoomBusy(true);
    try {
      applyRoom(await newRoomMatch(room.code, player.id));
    } catch (err) {
      setRoomError(describeRoomError(err));
    } finally {
      setRoomBusy(false);
    }
  };

  const handleNextRoomRound = async () => {
    if (!room) return;
    setRoomBusy(true);
    try {
      applyRoom(await nextRoomRound(room.code, player.id));
    } catch (err) {
      setRoomError(describeRoomError(err));
    } finally {
      setRoomBusy(false);
    }
  };

  const handleLeaveRoom = () => {
    if (room) leaveRoom(room.code, player.id);
    setRoom(null);
    setRoomError(null);
    setView('landing');
    // Drop the invite parameter so a refresh does not rejoin what you just left.
    if (typeof window !== 'undefined' && window.location.search.includes('room=')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  /**
   * Polling, not sockets: the room in the store is already the source of truth,
   * so this survives the app running on several replicas without a backplane.
   * It doubles as the presence heartbeat — a player who stops polling is dropped.
   */
  useEffect(() => {
    if (view !== 'room' || !room) return;
    const code = room.code;

    const id = window.setInterval(async () => {
      try {
        const next = await fetchRoom(code, player.id);
        roomFetchedAt.current = Date.now();
        setRoom(next);
      } catch (err) {
        // A room that has closed under us is worth surfacing; a blip is not.
        if (err instanceof RoomRequestError && err.status === 404) {
          setRoomError('That room has closed.');
          setRoom(null);
          setView('landing');
        }
      }
    }, ROOM_POLL_MS);

    return () => window.clearInterval(id);
  }, [view, room?.code, player.id]);

  const hasPlayedTodayOfficial = !!loadTodayDailyResult(todayStr);
  const handleNewPracticeRound = () => {
    setGameResult(null);
    setSubmitError(null);
    fetchPracticePuzzle(puzzle.letter);
  };

  const handleSubmitAnswers = async (answers: UserAnswers, timeTaken: number, remainingLives: number) => {
    setIsSubmitting(true);
    setSubmitError(null);

    // Scoring is server-only. If it cannot be reached the round is not recorded,
    // rather than being silently scored by a weaker local judge.
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

    // Play victory or try again audio feedback
    if (validationRes.totalScore >= 20) {
      playSuccessSound();
    } else {
      playFailureSound();
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

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col selection:bg-indigo-600 selection:text-white">
      {/* Top Navigation Header */}
      <Header
        streak={stats.currentStreak}
        mode={mode}
        showModeSelector={view === 'game'}
        onSelectMode={handleSelectMode}
        onGoHome={handleGoHome}
        onOpenStats={() => setIsStatsOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(!soundEnabled)}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-8">
        {view === 'landing' ? (
          <LandingScreen
            streak={stats.currentStreak}
            dayNumber={puzzle.dayNumber}
            hasPlayedToday={hasPlayedTodayOfficial}
            playerName={player.name}
            initialCode={inviteCode}
            isBusy={roomBusy}
            error={roomError}
            onDailyChallenge={handleDailyChallenge}
            onCreateRoom={handleCreateRoom}
            onJoinRoom={handleJoinRoom}
            onDismissError={() => setRoomError(null)}
          />
        ) : view === 'room' && room ? (
          <RoomScreen
            room={room}
            fetchedAtMs={roomFetchedAt.current}
            error={roomError}
            isBusy={roomBusy}
            onStartRound={handleStartRoomRound}
            onSubmit={handleRoomSubmit}
            onNextRound={handleNextRoomRound}
            onSetRounds={handleSetRoomRounds}
            onNewMatch={handleNewRoomMatch}
            onLeave={handleLeaveRoom}
          />
        ) : (
          <>
            {/* The way out of a round. The header logo goes home too, but that is
                not discoverable enough to be the only exit. */}
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

