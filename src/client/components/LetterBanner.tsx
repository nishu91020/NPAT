import React from 'react';
import { DailyPuzzle } from '../../shared/contract';
import { Sparkles, Calendar, Clock, Award, Flag, Utensils, Globe, TreePine, Layers } from 'lucide-react';

interface LetterBannerProps {
  puzzle: DailyPuzzle;
  hasPlayedToday?: boolean;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  Sparkles: <Sparkles className="w-5 h-5 text-indigo-600" />,
  Flag: <Flag className="w-5 h-5 text-amber-600" />,
  Utensils: <Utensils className="w-5 h-5 text-emerald-600" />,
  Globe: <Globe className="w-5 h-5 text-indigo-600" />,
  TreePine: <TreePine className="w-5 h-5 text-emerald-600" />,
  Layers: <Layers className="w-5 h-5 text-indigo-600" />,
  Award: <Award className="w-5 h-5 text-amber-500" />,
};

export const LetterBanner: React.FC<LetterBannerProps> = ({ puzzle, hasPlayedToday }) => {
  return (
    <div id="letter-banner-card" className="w-full bg-white border-2 border-slate-200 p-6 sm:p-8 shadow-sm relative overflow-hidden">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
        <div className="flex items-center gap-6">
          <div className="w-24 h-24 sm:w-28 sm:h-28 bg-indigo-600 flex items-center justify-center text-white font-black text-6xl sm:text-7xl shadow-[8px_8px_0px_0px_rgba(79,70,229,0.2)] shrink-0 select-none">
            {puzzle.letter}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 bg-slate-100 text-slate-700 border border-slate-200">
                Challenge #{puzzle.dayNumber}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {puzzle.dateString}
              </span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight uppercase">
              Today's Letter <span className="text-indigo-600 font-black">"{puzzle.letter}"</span>
            </h2>

            <p className="text-xs font-medium text-slate-500 mt-1 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-indigo-600" />
              Fill out Name, Place, Animal, Thing before the timer runs out!
            </p>
          </div>
        </div>

        <div className="w-full md:w-auto min-w-[280px] sm:min-w-[320px] bg-slate-50 border-l-4 border-amber-400 p-4 border-y border-r border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" />
              Bonus Challenge (+5 Pts Each)
            </span>
          </div>

          <div className="flex items-start gap-3">
            <div className="p-2 bg-white border border-slate-200 shrink-0">
              {ICON_MAP[puzzle.bonusChallenge.icon] || <Sparkles className="w-5 h-5 text-amber-500" />}
            </div>

            <div>
              <h4 className="text-sm font-extrabold text-slate-800 leading-snug uppercase tracking-tight">
                {puzzle.bonusChallenge.title}
              </h4>
              <p className="text-xs font-semibold text-slate-600 mt-0.5 leading-relaxed">
                {puzzle.bonusChallenge.description}
              </p>
            </div>
          </div>
        </div>
      </div>

      {hasPlayedToday && (
        <div className="mt-6 pt-4 border-t-2 border-slate-100 flex items-center justify-between text-xs font-bold text-indigo-700 bg-indigo-50/70 p-3 border border-indigo-100">
          <span>✓ Today's puzzle complete! Come back tomorrow for a new letter.</span>
        </div>
      )}
    </div>
  );
};

