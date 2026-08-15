import React, { useState, useEffect, useRef } from 'react';
import { UserAnswers, DailyPuzzle, CategoryKey } from '../../shared/contract';
import { CATEGORIES } from '../categories';
import { User, MapPin, Dog, Package, Clock, Heart, Send, Sparkles, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { playTickSound, playClickSound } from '../audio';

interface CategoryInputFormProps {
  puzzle: DailyPuzzle;
  onSubmit: (answers: UserAnswers, timeTaken: number, remainingLives: number) => void;
  isSubmitting: boolean;
}

const CATEGORY_NUMBERS: Record<CategoryKey, string> = {
  name: '01. Name',
  place: '02. Place',
  animal: '03. Animal',
  thing: '04. Thing',
};

export const CategoryInputForm: React.FC<CategoryInputFormProps> = ({
  puzzle,
  onSubmit,
  isSubmitting,
}) => {
  const [answers, setAnswers] = useState<UserAnswers>({
    name: '',
    place: '',
    animal: '',
    thing: '',
  });

  const [timeLeft, setTimeLeft] = useState<number>(puzzle.timeLimitSeconds);
  const [lives, setLives] = useState<number>(3);
  const [timerActive, setTimerActive] = useState<boolean>(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const targetLetter = puzzle.letter.toUpperCase();

  const startedAtRef = useRef<number>(Date.now());

  function elapsedSeconds(): number {
    return Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
  }

  useEffect(() => {
    setAnswers({ name: '', place: '', animal: '', thing: '' });    setTimeLeft(puzzle.timeLimitSeconds);
    setLives(3);
    setTimerActive(true);
    setValidationError(null);
    startedAtRef.current = Date.now();
  }, [puzzle]);

  useEffect(() => {
    if (!timerActive || isSubmitting) return;

    if (timeLeft <= 0) {
      setTimerActive(false);
      handleTimeOut();
      return;
    }

    if (timeLeft <= 10 && timeLeft > 0) {
      playTickSound();
    }

    timerRef.current = setTimeout(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timeLeft, timerActive, isSubmitting]);

  const handleTimeOut = () => {
    if (lives > 1) {
      setLives((l) => l - 1);
      setValidationError(`Time expired! You lost 1 life (${lives - 1} remaining). Adding +15s bonus time!`);
      setTimeLeft(15);
      setTimerActive(true);
    } else {
      setLives(0);
      setValidationError('Game Over! Time ran out. Submitting current entries...');
      onSubmit(answers, elapsedSeconds(), 0);
    }
  };

  const handleInputChange = (key: CategoryKey, val: string) => {
    setValidationError(null);
    setAnswers((prev) => ({
      ...prev,
      [key]: val,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const filledCount = (Object.values(answers) as string[]).filter((v) => v.trim().length > 0).length;
    if (filledCount === 0) {
      setValidationError(`Please fill out at least one category starting with "${targetLetter}".`);
      return;
    }

    setTimerActive(false);
    onSubmit(answers, elapsedSeconds(), lives);
  };

  const getLetterStatus = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const startsWith = trimmed.charAt(0).toUpperCase() === targetLetter;
    return startsWith;
  };

  const timerPercent = (timeLeft / puzzle.timeLimitSeconds) * 100;

  return (
    <form id="npat-input-form" onSubmit={handleSubmit} className="w-full space-y-8 bg-white p-6 sm:p-10 border-2 border-slate-200 shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pb-6 border-b-2 border-slate-200">
        <div className="border-l-4 border-indigo-600 pl-4">
          <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Time Remaining</p>
          <div className="flex items-baseline gap-3 mt-1">
            <span className={`text-3xl font-black font-mono tracking-tight ${timeLeft <= 10 ? 'text-rose-600 animate-pulse' : 'text-slate-900'}`}>
              00:{timeLeft < 10 ? `0${timeLeft}` : timeLeft}
            </span>
            <div className="flex-1 max-w-[140px] bg-slate-100 h-2 border border-slate-200">
              <div
                className={`h-full transition-all duration-1000 ${
                  timeLeft > 30 ? 'bg-indigo-600' : timeLeft > 10 ? 'bg-amber-500' : 'bg-rose-600'
                }`}
                style={{ width: `${Math.max(0, Math.min(100, timerPercent))}%` }}
              />
            </div>
          </div>
        </div>

        <div className="border-l-4 border-rose-500 pl-4">
          <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest">Lives Remaining</p>
          <div className="flex items-center gap-2 mt-2">
            {[1, 2, 3].map((num) => (
              <div
                key={num}
                className={`w-5 h-5 transition-all ${
                  num <= lives ? 'bg-rose-500 shadow-sm' : 'bg-slate-200 border border-slate-300'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {validationError && (
        <div className="p-4 bg-amber-50 border-l-4 border-amber-500 text-amber-900 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      <div className="space-y-6">
        {CATEGORIES.map((cat) => {
          const val = answers[cat.key];
          const status = getLetterStatus(val);

          return (
            <div key={cat.key} className="group">
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor={`input-${cat.key}`}
                  className="block text-[10px] font-black text-slate-400 uppercase tracking-widest"
                >
                  {CATEGORY_NUMBERS[cat.key]}
                </label>

                {status === true && (
                  <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 border border-emerald-200 uppercase tracking-widest flex items-center gap-1">
                    <Check className="w-3 h-3" /> Starts with {targetLetter}
                  </span>
                )}
                {status === false && (
                  <span className="text-[10px] font-black text-rose-700 bg-rose-50 px-2 py-0.5 border border-rose-200 uppercase tracking-widest">
                    Must start with "{targetLetter}"
                  </span>
                )}
              </div>

              <input
                id={`input-${cat.key}`}
                type="text"
                value={val}
                onChange={(e) => handleInputChange(cat.key, e.target.value)}
                placeholder={`${cat.label.toUpperCase()} STARTING WITH '${targetLetter}'...`}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className={`w-full min-h-[48px] border-b-4 p-3 sm:p-4 text-xl sm:text-3xl font-black uppercase outline-none transition-colors text-slate-900 bg-transparent placeholder:text-slate-300 placeholder:font-bold ${
                  status === true
                    ? 'border-emerald-500'
                    : status === false
                    ? 'border-rose-500'
                    : 'border-slate-200 focus:border-indigo-600'
                }`}
              />
            </div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4">
        <button
          type="button"
          onClick={() => {
            playClickSound();
            setAnswers({ name: '', place: '', animal: '', thing: '' });
          }}
          className="w-full sm:w-auto min-h-[48px] px-6 py-3 border-2 border-slate-200 hover:border-slate-400 text-slate-700 font-extrabold text-xs uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Clear All
        </button>

        <button
          id="submit-answers-btn"
          type="submit"
          disabled={isSubmitting}
          onClick={() => playClickSound()}
          className="w-full sm:w-auto flex-1 max-w-md min-h-[56px] py-4 sm:py-5 bg-slate-900 hover:bg-slate-800 text-white font-black text-base sm:text-lg uppercase tracking-widest shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)] hover:translate-y-[-2px] active:translate-y-[2px] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent animate-spin" />
              <span>Verifying Answers...</span>
            </>
          ) : (
            <>
              <Send className="w-5 h-5" />
              <span>Submit Today's Set</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
};
