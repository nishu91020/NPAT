import React, { useState, useEffect } from 'react';
import { useRoom } from './rooms/useRoom';
import { useDailyGame } from './daily/useDailyGame';
import { useGameStats } from './daily/useGameStats';
import { setMuted } from './audio';
import { Header } from './layout/Header';
import { AppFooter } from './layout/AppFooter';
import { LandingScreen } from './landing/LandingScreen';
import { RoomScreen } from './rooms/RoomScreen';
import { DailyGameScreen } from './daily/DailyGameScreen';
import { StreakStatsModal } from './modals/StreakStatsModal';
import { HelpRulesModal } from './modals/HelpRulesModal';
import { SeoFaqSection } from './layout/SeoFaqSection';

type View = 'landing' | 'game' | 'room';

export default function App() {
  const [view, setView] = useState<View>('landing');
  const [isStatsOpen, setIsStatsOpen] = useState<boolean>(false);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const { stats, record } = useGameStats();

  const daily = useDailyGame({
    onStarted: () => setView('game'),
    onCompleted: record,
  });

  const rooms = useRoom({
    onEntered: () => setView('room'),
    onExited: () => setView('landing'),
  });

  useEffect(() => {
    setMuted(!soundEnabled);
  }, [soundEnabled]);

  const handleGoHome = () => {
    daily.dismissError();
    rooms.release();
    setView('landing');
  };

  return (
    <div className="app">
      <Header
        streak={stats.currentStreak}
        onGoHome={handleGoHome}
        onOpenStats={() => setIsStatsOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(!soundEnabled)}
      />

      <main className="app__main">
        {view === 'landing' ? (
          <LandingScreen
            hasPlayedToday={daily.hasPlayedToday}
            playerName={rooms.playerName}
            initialCode={rooms.inviteCode}
            isBusy={rooms.isBusy}
            error={rooms.error}
            onDailyChallenge={daily.start}
            onCreateRoom={rooms.create}
            onJoinRoom={rooms.join}
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
          <DailyGameScreen
            puzzle={daily.puzzle}
            result={daily.result}
            hasPlayedToday={daily.hasPlayedToday}
            isSubmitting={daily.isSubmitting}
            error={daily.error}
            onSubmit={daily.submit}
            onBack={handleGoHome}
            onViewStats={() => setIsStatsOpen(true)}
          />
        )}
        <SeoFaqSection />
      </main>

      <AppFooter
        gamesPlayed={stats.gamesPlayed}
        onOpenHelp={() => setIsHelpOpen(true)}
        onOpenStats={() => setIsStatsOpen(true)}
      />

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
