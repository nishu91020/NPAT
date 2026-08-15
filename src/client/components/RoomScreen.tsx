import React, { useEffect, useRef, useState } from 'react';
import type { CategoryKey, RoomView, UserAnswers } from '../../shared/contract';
import { ROOM_ROUND_CHOICES } from '../../shared/contract';
import { CATEGORIES } from '../categories';
import { secondsLeft } from '../roomClient';
import { playClickSound, playTickSound } from '../audio';
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Loader2,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';

interface RoomScreenProps {
  room: RoomView;
  /** When `room` arrived, so the countdown measures against the server's clock. */
  fetchedAtMs: number;
  error: string | null;
  isBusy: boolean;
  onStartRound: () => void;
  /** `auto` marks the submission the clock made, not the player. */
  onSubmit: (answers: UserAnswers, auto?: boolean) => void;
  onNextRound: () => void;
  onSetRounds: (totalRounds: number) => void;
  onNewMatch: () => void;
  onLeave: () => void;
}

const EMPTY_ANSWERS: UserAnswers = { name: '', place: '', animal: '', thing: '' };

export const RoomScreen: React.FC<RoomScreenProps> = ({
  room,
  fetchedAtMs,
  error,
  isBusy,
  onStartRound,
  onSubmit,
  onNextRound,
  onSetRounds,
  onNewMatch,
  onLeave,
}) => {
  const [answers, setAnswers] = useState<UserAnswers>(EMPTY_ANSWERS);
  const [copied, setCopied] = useState(false);
  const [, setNowTick] = useState(0);
  const roundNumber = room.round?.number ?? 0;
  const lastRoundRef = useRef(roundNumber);
  const hasAutoSubmitted = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const you = room.players.find((p) => p.id === room.youId);
  const youHaveSubmitted = Boolean(you?.hasSubmitted);
  const youAreRacing = Boolean(you?.racing);
  const timeLeft = room.round ? secondsLeft(room.round, Date.now() - fetchedAtMs) : 0;

  const champions = room.standings.filter((row) => row.rank === 1).map((row) => row.name);
  const championLine =
    champions.length === 0
      ? '.'
      : champions.length === 1
        ? ` — ${champions[0]} takes it.`
        : ` — ${champions.slice(0, -1).join(', ')} and ${champions[champions.length - 1]} tie it.`;

  useEffect(() => {
    if (roundNumber !== lastRoundRef.current) {
      lastRoundRef.current = roundNumber;
      setAnswers(EMPTY_ANSWERS);
      hasAutoSubmitted.current = false;
    }
  }, [roundNumber]);

  useEffect(() => {
    if (room.phase === 'racing' && youAreRacing && !youHaveSubmitted && timeLeft <= 10 && timeLeft > 0) {
      playTickSound();
    }
  }, [timeLeft, room.phase, youAreRacing, youHaveSubmitted]);

  const answersRef = useRef(answers);
  answersRef.current = answers;

  useEffect(() => {
    if (room.phase !== 'racing' || !youAreRacing || youHaveSubmitted) return;
    if (timeLeft > 0 || hasAutoSubmitted.current) return;

    hasAutoSubmitted.current = true;
    onSubmit(answersRef.current, true);
  }, [timeLeft, room.phase, youAreRacing, youHaveSubmitted, roundNumber, onSubmit]);

  const targetLetter = (room.round?.letter ?? '').toUpperCase();

  const handleCopy = () => {
    playClickSound();
    const invite = `${window.location.origin}/?room=${room.code}`;
    void navigator.clipboard?.writeText(invite).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => undefined
    );
  };

  const letterStatus = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || !targetLetter) return null;
    return trimmed.charAt(0).toUpperCase() === targetLetter;
  };

  return (
    <section id="room-screen" className="w-full space-y-6">
      <div className="bg-white border-2 border-slate-200 p-4 sm:p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            id="room-leave-btn"
            onClick={() => {
              playClickSound();
              onLeave();
            }}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 border-2 border-slate-200 hover:border-slate-900 text-slate-700 font-black text-[10px] uppercase tracking-widest transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Leave
          </button>
          <div className="border-l-4 border-indigo-600 pl-4">
            <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">
              Room code
            </p>
            <p className="text-3xl font-black tracking-[0.2em] font-mono text-slate-900">
              {room.code}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> {room.players.length} here
          </span>
          <button
            id="room-copy-invite-btn"
            onClick={handleCopy}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 bg-white border-2 border-slate-200 hover:border-indigo-600 text-slate-700 font-black text-[10px] uppercase tracking-widest transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy invite'}
          </button>
        </div>
      </div>

      {error && (
        <div
          id="room-error"
          role="alert"
          className="p-4 bg-rose-50 border-l-4 border-rose-500 text-rose-900 text-xs font-bold uppercase tracking-wider"
        >
          {error}
        </div>
      )}

      <div className="bg-white border-2 border-slate-200 p-4 sm:p-6">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
          Players
        </p>
        <div className="flex flex-wrap gap-2">
          {room.players.map((player) => (
            <span
              key={player.id}
              className={`inline-flex items-center gap-2 px-3 py-2 border-2 text-xs font-black uppercase tracking-wider ${
                player.hasSubmitted
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              {player.isHost && <Crown className="w-3.5 h-3.5 text-amber-500" />}
              {player.name}
              {player.id === room.youId && <span className="text-slate-400">(you)</span>}
              {room.phase === 'racing' && player.racing && player.hasSubmitted && (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              )}
              {room.phase === 'racing' && !player.racing && (
                <span className="text-[9px] text-slate-400">next round</span>
              )}
            </span>
          ))}
        </div>
      </div>

      {room.phase === 'lobby' && (
        <div className="bg-white border-2 border-slate-200 p-6 sm:p-10 text-center">
          <Sparkles className="w-8 h-8 text-indigo-600 mx-auto" />
          <h3 className="mt-4 text-2xl font-black uppercase tracking-tight text-slate-900">
            {room.roundsPlayed === 0
              ? 'Waiting to start'
              : `Round ${room.roundsPlayed} of ${room.totalRounds} complete`}
          </h3>
          <p className="mt-2 text-sm text-slate-600 font-medium">
            {room.youAreHost
              ? 'Share the code, then start when everyone is in. Everyone races the same letter.'
              : 'Waiting for the host to start the next round.'}
          </p>

          {/* The match length. Settled before round one, because moving the finish
              line mid-match would move it for people who have already raced. */}
          <div className="mt-6 inline-block border-l-4 border-indigo-600 pl-4 text-left">
            <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">
              Match length
            </p>
            {room.youAreHost && room.canSetRounds ? (
              <div id="room-rounds-picker" className="mt-2 flex flex-wrap gap-2">
                {ROOM_ROUND_CHOICES.map((choice) => (
                  <button
                    key={choice}
                    id={`room-rounds-${choice}`}
                    type="button"
                    aria-pressed={room.totalRounds === choice}
                    onClick={() => {
                      playClickSound();
                      onSetRounds(choice);
                    }}
                    disabled={isBusy}
                    className={`min-h-[44px] px-4 py-2 border-2 font-black text-[10px] uppercase tracking-widest transition-colors disabled:opacity-50 ${
                      room.totalRounds === choice
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-600'
                    }`}
                  >
                    {choice} round{choice === 1 ? '' : 's'}
                  </button>
                ))}
              </div>
            ) : (
              <p
                id="room-rounds-fixed"
                className="mt-1 text-lg font-black uppercase tracking-tight text-slate-900"
              >
                {room.roundsPlayed} of {room.totalRounds} played
              </p>
            )}
          </div>

          {room.youAreHost && (
            <div>
              <button
                id="room-start-btn"
                onClick={() => {
                  playClickSound();
                  onStartRound();
                }}
                disabled={isBusy}
                className="mt-6 min-h-[56px] px-8 py-4 bg-slate-900 hover:bg-slate-800 text-white font-black text-base uppercase tracking-widest shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)] hover:translate-y-[-2px] active:translate-y-[2px] transition-all inline-flex items-center gap-3 disabled:opacity-50"
              >
                {isBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                {room.roundsPlayed === 0
                  ? `Start round 1 of ${room.totalRounds}`
                  : `Start round ${room.roundsPlayed + 1} of ${room.totalRounds}`}
              </button>
            </div>
          )}
        </div>
      )}

      {room.phase === 'racing' && room.round && (
        <div className="bg-white border-2 border-slate-200 p-6 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b-2 border-slate-200">
            <div className="flex items-center gap-5">
              <div className="w-20 h-20 bg-indigo-600 flex items-center justify-center text-white font-black text-5xl shadow-[6px_6px_0px_0px_rgba(79,70,229,0.2)] shrink-0">
                {targetLetter}
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Round {room.round.number} of {room.totalRounds}
                </p>
                <p className="text-sm font-black text-slate-900 uppercase tracking-tight">
                  {room.round.bonusChallenge.title}
                </p>
                <p className="text-xs text-slate-500 font-medium">
                  {room.round.bonusChallenge.description}
                </p>
              </div>
            </div>
            <div className="border-l-4 border-rose-500 pl-4">
              <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest">
                Time remaining
              </p>
              <p
                className={`text-4xl font-black font-mono ${
                  timeLeft <= 10 ? 'text-rose-600 animate-pulse' : 'text-slate-900'
                }`}
              >
                00:{timeLeft < 10 ? `0${timeLeft}` : timeLeft}
              </p>
            </div>
          </div>

          {!youAreRacing ? (
            <p className="text-sm text-slate-600 font-medium">
              You joined after this round started — you are in for the next one.
            </p>
          ) : youHaveSubmitted ? (
            <div className="text-center py-8">
              <Check className="w-10 h-10 text-emerald-600 mx-auto" />
              <p className="mt-3 text-lg font-black uppercase tracking-tight text-slate-900">
                Answers in
              </p>
              <p className="mt-1 text-sm text-slate-500 font-medium">
                Waiting for everyone else — or for the clock.
              </p>
            </div>
          ) : timeLeft <= 0 ? (
            <div className="text-center py-8">
              <Loader2 className="w-10 h-10 text-indigo-600 mx-auto animate-spin" />
              <p className="mt-3 text-lg font-black uppercase tracking-tight text-slate-900">
                Time — sending your answers
              </p>
              <p className="mt-1 text-sm text-slate-500 font-medium">
                Whatever you had typed goes in as it stands.
              </p>
            </div>
          ) : (
            <form
              id="room-answers-form"
              onSubmit={(e) => {
                e.preventDefault();
                playClickSound();
                onSubmit(answers);
              }}
              className="space-y-5"
            >
              {CATEGORIES.map((category) => {
                const key = category.key as CategoryKey;
                const status = letterStatus(answers[key]);
                return (
                  <div key={key}>
                    <label
                      htmlFor={`room-input-${key}`}
                      className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1"
                    >
                      {category.label}
                    </label>
                    <input
                      id={`room-input-${key}`}
                      value={answers[key]}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={`${category.label.toUpperCase()} WITH '${targetLetter}'...`}
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      className={`w-full min-h-[48px] border-b-4 p-3 text-xl sm:text-2xl font-black uppercase outline-none transition-colors text-slate-900 bg-transparent placeholder:text-slate-300 ${
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

              <button
                id="room-submit-btn"
                type="submit"
                disabled={isBusy}
                className="w-full min-h-[56px] py-4 bg-slate-900 hover:bg-slate-800 text-white font-black text-base uppercase tracking-widest shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
              >
                {isBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                Submit answers
              </button>
            </form>
          )}
        </div>
      )}

      {room.phase === 'judging' && (
        <div className="bg-white border-2 border-slate-200 p-10 text-center">
          <Loader2 className="w-10 h-10 text-indigo-600 mx-auto animate-spin" />
          <p className="mt-4 text-lg font-black uppercase tracking-tight text-slate-900">
            The referee is reading
          </p>
          <p className="mt-1 text-sm text-slate-500 font-medium">
            Every answer is being judged. This takes a few seconds.
          </p>
        </div>
      )}

      {room.phase === 'reveal' && room.results && (
        <div className="space-y-6">
          <div className="bg-white border-2 border-slate-200 p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="w-5 h-5 text-amber-500" />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Round leaderboard —{' '}
                {room.results.endedBy === 'clock' ? 'time ran out' : 'everyone finished'}
              </p>
            </div>

            <div className="space-y-3">
              {room.results.rows.map((row) => (
                <div
                  key={row.playerId}
                  className={`border-2 p-4 ${
                    row.rank === 1 ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-2xl font-black ${
                          row.rank === 1 ? 'text-amber-600' : 'text-slate-400'
                        }`}
                      >
                        {row.rank}
                        {row.tied ? '=' : ''}
                      </span>
                      <div>
                        <p className="font-black uppercase tracking-tight text-slate-900">
                          {row.name}
                          {row.playerId === room.youId && (
                            <span className="text-slate-400 font-bold"> (you)</span>
                          )}
                        </p>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          {row.auto ? 'Ran out of time' : `${row.timeTakenSeconds}s`}
                          {row.speedBonus > 0 && ` · +${row.speedBonus} speed`}
                        </p>
                      </div>
                    </div>
                    <span className="text-3xl font-black font-mono text-slate-900">
                      {row.totalScore}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {CATEGORIES.map((category) => {
                      const key = category.key as CategoryKey;
                      const verdict = row.categories[key];
                      return (
                        <div key={key} className="border-l-4 pl-2 border-slate-200">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                            {category.label}
                          </p>
                          <p
                            className={`text-sm font-black uppercase ${
                              verdict.valid ? 'text-emerald-700' : 'text-rose-600'
                            }`}
                          >
                            {row.answers[key] || '—'}
                          </p>
                          <p className="text-[10px] font-bold text-slate-400">
                            {verdict.points} pts
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {room.standings.length > 1 && (
            <div className="bg-white border-2 border-slate-200 p-4 sm:p-6">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                {room.matchComplete ? 'Final standings' : 'Session standings'} — round{' '}
                {room.roundsPlayed} of {room.totalRounds}
              </p>
              <table className="w-full text-sm">
                <tbody>
                  {room.standings.map((row) => (
                    <tr key={row.playerId} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 font-black text-slate-400 w-10">
                        {row.rank}
                        {row.tied ? '=' : ''}
                      </td>
                      <td className="py-2 font-black uppercase tracking-tight text-slate-900">
                        {row.name}
                      </td>
                      <td className="py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {row.wins} win{row.wins === 1 ? '' : 's'}
                      </td>
                      <td className="py-2 text-right font-black font-mono text-slate-900">
                        {row.totalScore}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {room.matchComplete && (
            <div
              id="room-match-complete"
              className="bg-white border-2 border-amber-300 bg-amber-50 p-6 text-center"
            >
              <Trophy className="w-8 h-8 text-amber-500 mx-auto" />
              <h3 className="mt-3 text-2xl font-black uppercase tracking-tight text-slate-900">
                Match complete
              </h3>
              <p className="mt-1 text-sm text-slate-600 font-medium">
                {room.totalRounds} round{room.totalRounds === 1 ? '' : 's'} played
                {championLine}
              </p>
            </div>
          )}

          {room.youAreHost ? (
            <button
              id={room.matchComplete ? 'room-new-match-btn' : 'room-next-round-btn'}
              onClick={() => {
                playClickSound();
                if (room.matchComplete) onNewMatch();
                else onNextRound();
              }}
              disabled={isBusy}
              className="w-full min-h-[56px] py-4 bg-slate-900 hover:bg-slate-800 text-white font-black text-base uppercase tracking-widest shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
            >
              {room.matchComplete ? (
                <>
                  <RotateCcw className="w-5 h-5" /> New match
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" /> Back to the lobby
                </>
              )}
            </button>
          ) : (
            <p className="text-center text-xs font-black uppercase tracking-widest text-slate-400">
              {room.matchComplete
                ? 'Waiting for the host to start a new match'
                : 'Waiting for the host to continue'}
            </p>
          )}
        </div>
      )}
    </section>
  );
};
