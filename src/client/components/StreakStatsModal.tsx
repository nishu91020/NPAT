import React from 'react';
import { GameStats, GameResult } from '../types';
import { X, Flame, Trophy, Target, BarChart2, Calendar, Sparkles } from 'lucide-react';
import { playClickSound } from '../audio';

interface StreakStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: GameStats;
}

export const StreakStatsModal: React.FC<StreakStatsModalProps> = ({ isOpen, onClose, stats }) => {
  if (!isOpen) return null;

  const winRate = stats.gamesPlayed > 0 ? Math.round((stats.wins / stats.gamesPlayed) * 100) : 0;
  const avgScore = stats.gamesPlayed > 0 ? Math.round(stats.totalScore / stats.gamesPlayed) : 0;
  const historyList = (Object.values(stats.history) as GameResult[]).reverse().slice(0, 10);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white max-w-lg w-full p-6 sm:p-8 border-2 border-slate-200 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.15)] relative">
        {/* Close button */}
        <button
          onClick={() => {
            playClickSound();
            onClose();
          }}
          className="absolute top-5 right-5 p-2 text-slate-400 hover:text-slate-900 border border-slate-200 hover:bg-slate-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 bg-indigo-600 text-white flex items-center justify-center font-black text-2xl shadow-[4px_4px_0px_0px_rgba(79,70,229,0.3)] shrink-0">
            <Trophy className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl sm:text-2xl font-black text-slate-900 uppercase tracking-tight">Your Statistics & Streaks</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Track your daily progress & performance</p>
          </div>
        </div>

        {/* 4 Geometric Stat Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-indigo-50 p-4 border-l-4 border-indigo-600 border-y border-r border-indigo-200 text-center">
            <Flame className="w-5 h-5 text-indigo-600 mx-auto mb-1 fill-indigo-600" />
            <p className="text-2xl font-black text-slate-900 italic">{stats.currentStreak}</p>
            <p className="text-[10px] font-black uppercase text-indigo-700 tracking-widest mt-0.5">Streak</p>
          </div>

          <div className="bg-slate-50 p-4 border-2 border-slate-200 text-center">
            <Trophy className="w-5 h-5 text-amber-500 mx-auto mb-1" />
            <p className="text-2xl font-black text-slate-900">{stats.maxStreak}</p>
            <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest mt-0.5">Best</p>
          </div>

          <div className="bg-slate-50 p-4 border-2 border-slate-200 text-center">
            <Target className="w-5 h-5 text-emerald-600 mx-auto mb-1" />
            <p className="text-2xl font-black text-slate-900">{winRate}%</p>
            <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest mt-0.5">Win Rate</p>
          </div>

          <div className="bg-slate-50 p-4 border-2 border-slate-200 text-center">
            <BarChart2 className="w-5 h-5 text-indigo-600 mx-auto mb-1" />
            <p className="text-2xl font-black text-slate-900">{avgScore}</p>
            <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest mt-0.5">Avg Pts</p>
          </div>
        </div>

        {/* History Log */}
        <div>
          <h4 className="text-[10px] uppercase font-black tracking-widest text-slate-400 mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            Recent Game History
          </h4>

          {historyList.length === 0 ? (
            <div className="bg-slate-50 p-6 border-2 border-slate-200 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
              No games completed yet. Play today's puzzle to build your streak!
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {historyList.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-xs transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 bg-indigo-600 text-white font-black flex items-center justify-center text-xs uppercase">
                      {item.letter}
                    </span>
                    <div>
                      <p className="font-extrabold text-slate-900 uppercase tracking-tight">
                        {item.mode === 'practice' ? 'Practice' : `Challenge #${item.dayNumber}`}
                      </p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{item.completedAt.split('T')[0]}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-black text-indigo-600 text-sm">{item.score} Pts</span>
                    <p className="text-[10px] font-bold text-slate-500 uppercase">{item.timeTaken}s</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Action Footer */}
        <div className="mt-6 pt-4 border-t-2 border-slate-100 flex justify-end">
          <button
            onClick={() => {
              playClickSound();
              onClose();
            }}
            className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest transition-colors shadow-[3px_3px_0px_0px_rgba(0,0,0,0.1)]"
          >
            Close Stats
          </button>
        </div>
      </div>
    </div>
  );
};

