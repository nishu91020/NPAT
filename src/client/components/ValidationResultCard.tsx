import React, { useState } from 'react';
import { GameResult } from '../types';
import { generateShareCard } from '../shareCard';
import { isAiJudged } from '../judgedBy';
import { Trophy, Share2, Copy, Check, Sparkles, Flame, ArrowRight, User, MapPin, Dog, Package, Award, Lightbulb } from 'lucide-react';
import { playClickSound, playSuccessSound } from '../audio';

interface ValidationResultCardProps {
  result: GameResult;
  onViewStats: () => void;
}

const CATEGORY_NAMES = {
  name: 'Name',
  place: 'Place',
  animal: 'Animal',
  thing: 'Thing',
};

export const ValidationResultCard: React.FC<ValidationResultCardProps> = ({
  result,
  onViewStats,
}) => {
  const [copied, setCopied] = useState(false);

  const shareText = generateShareCard(
    result.dayNumber,
    result.letter,
    result.validation.totalScore,
    result.streak,
    result.validation.categories
  );

  const handleCopy = () => {
    playClickSound();
    playSuccessSound();
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const isWin = result.validation.totalScore >= 20;

  return (
    <div id="validation-result-card" className="w-full bg-white border-2 border-slate-200 p-6 sm:p-10 shadow-sm space-y-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 pb-6 border-b-2 border-slate-200">
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 bg-indigo-600 text-white flex items-center justify-center font-black text-4xl shadow-[6px_6px_0px_0px_rgba(79,70,229,0.2)] shrink-0">
            {result.validation.totalScore}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">
                Challenge #{result.dayNumber}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 uppercase tracking-widest">
                Letter '{result.letter}'
              </span>
              {isAiJudged(result.validation.judgedBy) && (
                <span className="text-[10px] font-extrabold px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-indigo-600" />
                  AI Referee
                </span>
              )}
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 uppercase tracking-tight mt-1">
              {isWin ? 'Set Validated! 🎉' : 'Keep Practicing! 👍'}
            </h2>
            <p className="text-xs font-semibold text-slate-500 mt-0.5">{result.validation.overallFeedback}</p>
          </div>
        </div>

        <div className="bg-slate-50 border-l-4 border-indigo-600 border-y border-r border-slate-200 px-5 py-3 flex items-center gap-3">
          <Flame className="w-6 h-6 text-indigo-600 fill-indigo-600" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Current Streak</p>
            <p className="text-lg font-black text-slate-900 italic">{result.streak} Days 🔥</p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs uppercase font-black tracking-widest text-slate-400 mb-4 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-600" />
          Category Evaluation Breakdown
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(['name', 'place', 'animal', 'thing'] as const).map((key) => {
            const item = result.validation.categories[key];
            const answerWord = result.answers[key] || '(No Entry)';

            return (
              <div
                key={key}
                className={`p-5 border-2 transition-all ${
                  item.valid
                    ? item.bonusMatched
                      ? 'bg-amber-50/50 border-amber-300'
                      : 'bg-emerald-50/50 border-emerald-300'
                    : 'bg-rose-50/50 border-rose-300'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {CATEGORY_NAMES[key]}
                  </span>

                  <div className="flex items-center gap-2">
                    {item.bonusMatched && (
                      <span className="text-[10px] font-black px-2 py-0.5 bg-amber-500 text-white uppercase tracking-widest">
                        +5 Bonus!
                      </span>
                    )}
                    <span
                      className={`text-xs font-black px-2.5 py-1 uppercase tracking-wider ${
                        item.valid ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      +{item.points} Pts
                    </span>
                  </div>
                </div>

                <p className="text-xl font-black text-slate-900 uppercase tracking-wide font-mono">
                  "{answerWord}"
                </p>

                <p className="text-xs font-semibold text-slate-600 mt-2 leading-snug">
                  {item.feedback}
                </p>

                {item.suggestion && (
                  <p
                    className={`text-[10px] font-black uppercase tracking-widest mt-2 pt-2 border-t border-slate-200/70 flex items-center gap-1.5 ${
                      item.valid ? 'text-amber-700' : 'text-slate-500'
                    }`}
                  >
                    <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>
                      {item.valid ? 'Bonus:' : 'Try:'}{' '}
                      <span className="text-slate-900 font-mono normal-case tracking-normal text-xs">
                        {item.suggestion}
                      </span>
                    </span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-slate-50 border-2 border-slate-200 p-4 flex flex-wrap items-center justify-between gap-4 text-xs font-extrabold uppercase tracking-widest text-slate-700">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-indigo-600" />
          <span>Speed Bonus: <strong className="text-slate-900">+{result.validation.speedBonus} Pts</strong> ({result.timeTaken}s taken)</span>
        </div>
        <div>
          <span>Total Score: <strong className="text-indigo-600 font-black text-base">{result.validation.totalScore} Pts</strong></span>
        </div>
      </div>

      <div className="bg-slate-900 text-slate-100 p-6 border-2 border-slate-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <span className="text-xs font-black uppercase tracking-widest text-indigo-400 flex items-center gap-2">
            <Share2 className="w-4 h-4" />
            Shareable Results Card
          </span>

          <button
            id="copy-share-card-btn"
            onClick={handleCopy}
            className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs uppercase tracking-widest shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)] transition-all active:translate-y-0.5 flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-white" />
                <span>Copied to Clipboard!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copy Result Card</span>
              </>
            )}
          </button>
        </div>

        <pre className="font-mono text-xs leading-relaxed bg-slate-950 p-4 border border-slate-800 text-slate-300 whitespace-pre-wrap select-all">
          {shareText}
        </pre>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
        <button
          onClick={() => {
            playClickSound();
            onViewStats();
          }}
          className="w-full sm:w-auto px-6 py-3.5 border-2 border-slate-200 hover:border-slate-400 text-slate-800 font-extrabold text-xs uppercase tracking-widest transition-colors"
        >
          View Streaks & Stats
        </button>
      </div>
    </div>
  );
};

