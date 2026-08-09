import React from 'react';
import { X, HelpCircle, Sparkles, CheckCircle2, Trophy, Clock, Share2 } from 'lucide-react';
import { playClickSound } from '../audio';

interface HelpRulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpRulesModal: React.FC<HelpRulesModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white max-w-lg w-full p-6 sm:p-8 border-2 border-slate-200 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.15)] relative max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
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
            <HelpCircle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl sm:text-2xl font-black text-slate-900 uppercase tracking-tight">How to Play</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Name • Place • Animal • Thing Game Rules</p>
          </div>
        </div>

        <div className="space-y-4 text-xs font-semibold text-slate-700 leading-relaxed">
          {/* Rule 1 */}
          <div className="flex items-start gap-3 p-4 bg-slate-50 border-2 border-slate-200">
            <span className="w-6 h-6 bg-slate-900 text-white font-black flex items-center justify-center text-xs shrink-0">1</span>
            <div>
              <h4 className="font-black text-slate-900 text-sm uppercase tracking-tight mb-1">Daily Target Letter</h4>
              <p>
                All 4 entries (Name, Place, Animal, Thing) must strictly start with today's assigned letter.
              </p>
            </div>
          </div>

          {/* Rule 2 */}
          <div className="flex items-start gap-3 p-4 bg-slate-50 border-2 border-slate-200">
            <span className="w-6 h-6 bg-indigo-600 text-white font-black flex items-center justify-center text-xs shrink-0">2</span>
            <div>
              <h4 className="font-black text-slate-900 text-sm uppercase tracking-tight mb-1">Timer & Lives</h4>
              <p>
                Complete your entries before the timer expires. Letting time run out costs 1 life. Submitting early awards speed bonus points!
              </p>
            </div>
          </div>

          {/* Rule 3 */}
          <div className="flex items-start gap-3 p-4 bg-amber-50 border-l-4 border-amber-500 border-y border-r border-amber-200">
            <span className="w-6 h-6 bg-amber-600 text-white font-black flex items-center justify-center text-xs shrink-0">3</span>
            <div>
              <h4 className="font-black text-amber-900 text-sm uppercase tracking-tight mb-1 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" /> Daily Bonus Challenge (+5 Pts Each)
              </h4>
              <p className="text-amber-900">
                Fulfill the special rule (e.g. 6+ letters, regional connections, specific themes) for extra points per category!
              </p>
            </div>
          </div>

          {/* Rule 4 */}
          <div className="flex items-start gap-3 p-4 bg-slate-50 border-2 border-slate-200">
            <span className="w-6 h-6 bg-slate-900 text-white font-black flex items-center justify-center text-xs shrink-0">4</span>
            <div>
              <h4 className="font-black text-slate-900 text-sm uppercase tracking-tight mb-1 flex items-center gap-1.5">
                <Share2 className="w-3.5 h-3.5 text-indigo-600" /> Shareable Grid & Daily Streaks
              </h4>
              <p>
                AI scores each entry. Copy your grid result card to share your daily score and maintain your active streak!
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t-2 border-slate-100 flex justify-end">
          <button
            onClick={() => {
              playClickSound();
              onClose();
            }}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs uppercase tracking-widest transition-colors shadow-[3px_3px_0px_0px_rgba(79,70,229,0.3)]"
          >
            Got It, Let's Play!
          </button>
        </div>
      </div>
    </div>
  );
};

