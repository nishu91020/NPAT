import React, { useState } from 'react';
import { Sparkles, Users, LogIn, Flame, Calendar, Check, ArrowLeft, Loader2 } from 'lucide-react';
import { playClickSound } from '../audio';

type RoomIntent = 'create' | 'join';

interface LandingScreenProps {
  streak: number;
  dayNumber: number;
  hasPlayedToday: boolean;
  playerName: string;
  /** Prefilled from an invite link, so a guest only has to type their name. */
  initialCode: string;
  isBusy: boolean;
  error: string | null;
  onDailyChallenge: () => void;
  onCreateRoom: (name: string) => void;
  onJoinRoom: (name: string, code: string) => void;
  onDismissError: () => void;
}

/**
 * The front door. Three ways in: play today's puzzle alone, or play it with
 * other people by creating a room or joining one.
 *
 * The two room buttons open a small form rather than navigating, because the only
 * things a room needs are a name and — to join — a code.
 */
export const LandingScreen: React.FC<LandingScreenProps> = ({
  streak,
  dayNumber,
  hasPlayedToday,
  playerName,
  initialCode,
  isBusy,
  error,
  onDailyChallenge,
  onCreateRoom,
  onJoinRoom,
  onDismissError,
}) => {
  const [intent, setIntent] = useState<RoomIntent | null>(initialCode ? 'join' : null);
  const [name, setName] = useState(playerName);
  const [code, setCode] = useState(initialCode);

  const open = (next: RoomIntent) => {
    playClickSound();
    onDismissError();
    setIntent(next);
  };

  const close = () => {
    playClickSound();
    onDismissError();
    setIntent(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    playClickSound();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (intent === 'create') onCreateRoom(trimmed);
    else onJoinRoom(trimmed, code.trim().toUpperCase());
  };

  const canSubmit =
    name.trim().length > 0 && (intent === 'create' || code.trim().length >= 4) && !isBusy;

  return (
    <section id="landing-screen" className="w-full space-y-8">
      <div className="bg-white border-2 border-slate-200 p-6 sm:p-10 shadow-sm">
        <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">
          Name • Place • Animal • Thing
        </p>
        <h2 className="mt-3 text-3xl sm:text-5xl font-black tracking-tighter uppercase text-slate-900">
          One letter. Four answers.
          <br />
          Sixty seconds.
        </h2>
        <p className="mt-4 max-w-2xl text-sm sm:text-base text-slate-600 font-medium">
          A new letter every day, judged by an AI referee. Play it on your own, or start a room and
          race your friends through the same letter at the same time.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" /> Challenge #{dayNumber}
          </span>
          <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 bg-indigo-50 text-indigo-900 border border-indigo-200 flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-indigo-600 fill-indigo-600" /> {streak} day streak
          </span>
          {hasPlayedToday && (
            <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> Today complete
            </span>
          )}
        </div>
      </div>

      {intent === null ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          <button
            id="landing-daily-btn"
            onClick={() => {
              playClickSound();
              onDailyChallenge();
            }}
            className="group text-left min-h-[48px] p-6 bg-slate-900 text-white border-2 border-slate-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)] hover:translate-y-[-2px] active:translate-y-[2px] transition-all"
          >
            <Sparkles className="w-7 h-7 text-indigo-300" />
            <h3 className="mt-4 text-lg font-black uppercase tracking-tight">Daily Challenge</h3>
            <p className="mt-1.5 text-xs font-medium text-slate-300">
              {hasPlayedToday
                ? "You've played today — review your round or practise."
                : "Today's letter, on your own. Keeps your streak alive."}
            </p>
            <span className="mt-4 inline-block text-[10px] font-black uppercase tracking-widest text-indigo-300">
              Play now →
            </span>
          </button>

          <button
            id="landing-create-room-btn"
            onClick={() => open('create')}
            className="group text-left min-h-[48px] p-6 bg-white border-2 border-slate-200 hover:border-indigo-600 shadow-[6px_6px_0px_0px_rgba(0,0,0,0.05)] hover:translate-y-[-2px] active:translate-y-[2px] transition-all"
          >
            <Users className="w-7 h-7 text-indigo-600" />
            <h3 className="mt-4 text-lg font-black uppercase tracking-tight text-slate-900">
              Create Room
            </h3>
            <p className="mt-1.5 text-xs font-medium text-slate-500">
              Start a room, share the code, and race the same letter together.
            </p>
            <span className="mt-4 inline-block text-[10px] font-black uppercase tracking-widest text-indigo-600">
              Start a room →
            </span>
          </button>

          <button
            id="landing-join-room-btn"
            onClick={() => open('join')}
            className="group text-left min-h-[48px] p-6 bg-white border-2 border-slate-200 hover:border-emerald-600 shadow-[6px_6px_0px_0px_rgba(0,0,0,0.05)] hover:translate-y-[-2px] active:translate-y-[2px] transition-all"
          >
            <LogIn className="w-7 h-7 text-emerald-600" />
            <h3 className="mt-4 text-lg font-black uppercase tracking-tight text-slate-900">
              Join Room
            </h3>
            <p className="mt-1.5 text-xs font-medium text-slate-500">
              Got a code from a friend? Enter it and take your seat.
            </p>
            <span className="mt-4 inline-block text-[10px] font-black uppercase tracking-widest text-emerald-700">
              Enter a code →
            </span>
          </button>
        </div>
      ) : (
        <form
          id="landing-room-form"
          onSubmit={submit}
          className="bg-white border-2 border-slate-200 p-6 sm:p-8 space-y-6 max-w-xl"
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              id="landing-room-back-btn"
              onClick={close}
              className="min-h-[44px] inline-flex items-center gap-2 px-3 py-2 border-2 border-slate-200 hover:border-slate-900 text-slate-700 font-black text-[10px] uppercase tracking-widest transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <h3 className="text-xl font-black uppercase tracking-tight text-slate-900">
              {intent === 'create' ? 'Create a room' : 'Join a room'}
            </h3>
          </div>

          <div>
            <label
              htmlFor="landing-name-input"
              className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1"
            >
              Your name
            </label>
            <input
              id="landing-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="WHAT SHOULD WE CALL YOU?"
              maxLength={20}
              autoFocus
              autoComplete="off"
              className="w-full min-h-[48px] border-b-4 border-slate-200 focus:border-indigo-600 p-3 text-xl font-black uppercase outline-none transition-colors text-slate-900 bg-transparent placeholder:text-slate-300"
            />
          </div>

          {intent === 'join' && (
            <div>
              <label
                htmlFor="landing-code-input"
                className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1"
              >
                Room code
              </label>
              <input
                id="landing-code-input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABCD"
                maxLength={4}
                autoComplete="off"
                className="w-full min-h-[48px] border-b-4 border-slate-200 focus:border-emerald-600 p-3 text-3xl font-black uppercase font-mono tracking-[0.3em] outline-none transition-colors text-slate-900 bg-transparent placeholder:text-slate-300"
              />
            </div>
          )}

          {error && (
            <div
              id="landing-room-error"
              role="alert"
              className="p-4 bg-rose-50 border-l-4 border-rose-500 text-rose-900 text-xs font-bold uppercase tracking-wider"
            >
              {error}
            </div>
          )}

          <button
            id="landing-room-submit-btn"
            type="submit"
            disabled={!canSubmit}
            className="w-full min-h-[56px] py-4 bg-slate-900 hover:bg-slate-800 text-white font-black text-base uppercase tracking-widest shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)] transition-all flex items-center justify-center gap-3 disabled:opacity-40"
          >
            {isBusy ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : intent === 'create' ? (
              <Users className="w-5 h-5" />
            ) : (
              <LogIn className="w-5 h-5" />
            )}
            {intent === 'create' ? 'Create room' : 'Join room'}
          </button>
        </form>
      )}
    </section>
  );
};
