import React from 'react';
import { Flame, HelpCircle, Volume2, VolumeX } from 'lucide-react';
import { playClickSound } from '../audio';

interface HeaderProps {
  streak: number;
  onGoHome: () => void;
  onOpenStats: () => void;
  onOpenHelp: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  streak,
  onGoHome,
  onOpenStats,
  onOpenHelp,
  soundEnabled,
  onToggleSound,
}) => {
  return (
    <header id="main-header" className="site-header">
      <div className="site-header__inner">
        <button
          id="header-home-btn"
          type="button"
          onClick={() => {
            playClickSound();
            onGoHome();
          }}
          title="Back to the start"
          className="site-header__home"
        >
          <div className="site-header__logo">L</div>
          <div>
            <h1 className="site-header__title">
              Letters Daily
              <span className="site-header__badge">NPAT</span>
            </h1>
            <p className="site-header__tagline">Name • Place • Animal • Thing</p>
          </div>
        </button>

        <div className="site-header__actions">
          <button
            id="header-streak-btn"
            onClick={() => {
              playClickSound();
              onOpenStats();
            }}
            title="Your statistics & streaks"
            aria-label="Your statistics and streaks"
            className="site-header__streak"
          >
            <Flame />
            <span className="site-header__streak-value">{streak} Days</span>
          </button>

          <button
            id="header-sound-btn"
            onClick={() => {
              onToggleSound();
              playClickSound();
            }}
            title={soundEnabled ? 'Mute Sounds' : 'Enable Sounds'}
            className="site-header__icon-btn"
          >
            {soundEnabled ? <Volume2 /> : <VolumeX className="is-muted" />}
          </button>

          <button
            id="header-help-btn"
            onClick={() => {
              playClickSound();
              onOpenHelp();
            }}
            title="How to Play & Bonus Rules"
            className="site-header__icon-btn"
          >
            <HelpCircle />
          </button>
        </div>
      </div>
    </header>
  );
};

