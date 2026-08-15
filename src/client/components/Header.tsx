import React from 'react';
import { Flame, BarChart3, HelpCircle, Volume2, VolumeX } from 'lucide-react';
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
    <header id="main-header" className="w-full bg-white border-b-2 border-slate-200 sticky top-0 z-30 shadow-sm">
      <div className="max-w-5xl mx-auto px-3 sm:px-8 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-3">
        {/* App Branding — also the way back to the front door */}
        <button
          id="header-home-btn"
          type="button"
          onClick={() => {
            playClickSound();
            onGoHome();
          }}
          title="Back to the start"
          className="flex items-center gap-2 sm:gap-3 text-left min-h-[44px]"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 bg-indigo-600 text-white font-black text-xl sm:text-2xl flex items-center justify-center shadow-[3px_3px_0px_0px_rgba(79,70,229,0.3)] tracking-tighter shrink-0">
            L
          </div>
          <div>
            <h1 className="font-black text-lg sm:text-2xl text-slate-900 leading-none tracking-tighter uppercase flex items-center gap-1.5 sm:gap-2">
              Letters Daily
              <span className="text-[9px] sm:text-[10px] font-black tracking-widest px-1.5 sm:px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200">
                NPAT
              </span>
            </h1>
            <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 tracking-widest uppercase hidden sm:block mt-0.5">
              Name • Place • Animal • Thing
            </p>
          </div>
        </button>

        {/* Action Controls & Streak */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Daily Streak Badge */}
          <button
            id="header-streak-btn"
            onClick={() => {
              playClickSound();
              onOpenStats();
            }}
            title="View Streaks & Stats"
            className="flex items-center gap-1.5 min-h-[44px] px-2.5 sm:px-3 py-1.5 bg-indigo-50 text-indigo-900 border-2 border-indigo-200 hover:border-indigo-400 transition-all text-xs"
          >
            <Flame className="w-4 h-4 text-indigo-600 fill-indigo-600 shrink-0" />
            <span className="font-black text-xs sm:text-sm italic">{streak} Days</span>
          </button>

          {/* Sound Toggle */}
          <button
            id="header-sound-btn"
            onClick={() => {
              onToggleSound();
              playClickSound();
            }}
            title={soundEnabled ? 'Mute Sounds' : 'Enable Sounds'}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
          </button>

          {/* Stats Button */}
          <button
            id="header-stats-btn"
            onClick={() => {
              playClickSound();
              onOpenStats();
            }}
            title="Leaderboard & Statistics"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors"
          >
            <BarChart3 className="w-4 h-4" />
          </button>

          {/* Help Button */}
          <button
            id="header-help-btn"
            onClick={() => {
              playClickSound();
              onOpenHelp();
            }}
            title="How to Play & Bonus Rules"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

