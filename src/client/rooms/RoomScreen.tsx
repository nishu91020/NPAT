import React, { useEffect, useRef, useState } from 'react';
import type { CategoryKey, RoomView, UserAnswers } from '../../shared/contract';
import { ROOM_ROUND_CHOICES } from '../../shared/contract';
import { CATEGORIES } from '../categories';
import { secondsLeft } from './roomClient';
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

  fetchedAtMs: number;
  error: string | null;
  isBusy: boolean;
  onStartRound: () => void;

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
    <section id="room-screen" className="room">
      <div className="panel room__bar">
        <div className="room__bar-left">
          <button
            id="room-leave-btn"
            onClick={() => {
              playClickSound();
              onLeave();
            }}
            className="btn-outline"
          >
            <ArrowLeft /> Leave
          </button>
          <div className="room__code">
            <p className="room__code-label">Room code</p>
            <p className="room__code-value">{room.code}</p>
          </div>
        </div>

        <div className="room__bar-right">
          <span className="chip">
            <Users /> {room.players.length} here
          </span>
          <button
            id="room-copy-invite-btn"
            onClick={handleCopy}
            className="btn-outline btn-outline--filled btn-outline--accent"
          >
            {copied ? <Check className="room__copied-icon" /> : <Copy />}
            {copied ? 'Copied' : 'Copy invite'}
          </button>
        </div>
      </div>

      {error && (
        <div id="room-error" role="alert" className="alert alert--error">
          {error}
        </div>
      )}

      <div className="panel room__panel">
        <p className="room__section-label">Players</p>
        <div className="room__player-list">
          {room.players.map((player) => (
            <span
              key={player.id}
              className={`room__player${player.hasSubmitted ? ' room__player--submitted' : ''}`}
            >
              {player.isHost && <Crown className="room__player-host-icon" />}
              {player.name}
              {player.id === room.youId && <span className="room__player-you">(you)</span>}
              {room.phase === 'racing' && player.racing && player.hasSubmitted && (
                <Check className="room__player-done-icon" />
              )}
              {room.phase === 'racing' && !player.racing && (
                <span className="room__player-next">next round</span>
              )}
            </span>
          ))}
        </div>
      </div>

      {room.phase === 'lobby' && (
        <div className="panel room__lobby">
          <Sparkles />
          <h3 className="room__lobby-title">
            {room.roundsPlayed === 0
              ? 'Waiting to start'
              : `Round ${room.roundsPlayed} of ${room.totalRounds} complete`}
          </h3>
          <p className="room__lobby-text">
            {room.youAreHost
              ? 'Share the code, then start when everyone is in. Everyone races the same letter.'
              : 'Waiting for the host to start the next round.'}
          </p>

          <div className="room__rounds">
            <p className="room__rounds-label">Match length</p>
            {room.youAreHost && room.canSetRounds ? (
              <div id="room-rounds-picker" className="room__rounds-picker">
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
                    className={`room__round-btn${
                      room.totalRounds === choice ? ' room__round-btn--active' : ''
                    }`}
                  >
                    {choice} round{choice === 1 ? '' : 's'}
                  </button>
                ))}
              </div>
            ) : (
              <p id="room-rounds-fixed" className="room__rounds-fixed">
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
                className="btn-primary btn-primary--inline btn-primary--lift room__start-btn"
              >
                {isBusy ? <Loader2 className="spinner" /> : <Play />}
                {room.roundsPlayed === 0
                  ? `Start round 1 of ${room.totalRounds}`
                  : `Start round ${room.roundsPlayed + 1} of ${room.totalRounds}`}
              </button>
            </div>
          )}
        </div>
      )}

      {room.phase === 'racing' && room.round && (
        <div className="panel room__race">
          <div className="room__race-head">
            <div className="room__race-identity">
              <div className="room__letter">{targetLetter}</div>
              <div>
                <p className="room__round-label">
                  Round {room.round.number} of {room.totalRounds}
                </p>
                <p className="room__bonus-title">{room.round.bonusChallenge.title}</p>
                <p className="room__bonus-desc">{room.round.bonusChallenge.description}</p>
              </div>
            </div>
            <div className="room__timer">
              <p className="room__timer-label">Time remaining</p>
              <p
                className={`room__timer-value${
                  timeLeft <= 10 ? ' room__timer-value--urgent' : ''
                }`}
              >
                00:{timeLeft < 10 ? `0${timeLeft}` : timeLeft}
              </p>
            </div>
          </div>

          {!youAreRacing ? (
            <p className="room__notice">
              You joined after this round started — you are in for the next one.
            </p>
          ) : youHaveSubmitted ? (
            <div className="room__status">
              <Check className="room__status-icon--done" />
              <p className="room__status-title">Answers in</p>
              <p className="room__status-text">Waiting for everyone else — or for the clock.</p>
            </div>
          ) : timeLeft <= 0 ? (
            <div className="room__status">
              <Loader2 className="spinner spinner--lg" />
              <p className="room__status-title">Time — sending your answers</p>
              <p className="room__status-text">Whatever you had typed goes in as it stands.</p>
            </div>
          ) : (
            <form
              id="room-answers-form"
              onSubmit={(e) => {
                e.preventDefault();
                playClickSound();
                onSubmit(answers);
              }}
              className="room__form"
            >
              {CATEGORIES.map((category) => {
                const key = category.key as CategoryKey;
                const status = letterStatus(answers[key]);
                return (
                  <div key={key}>
                    <label htmlFor={`room-input-${key}`} className="field-label room__label">
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
                      className={`answer-input room__input${
                        status === true
                          ? ' answer-input--valid'
                          : status === false
                            ? ' answer-input--invalid'
                            : ''
                      }`}
                    />
                  </div>
                );
              })}

              <button
                id="room-submit-btn"
                type="submit"
                disabled={isBusy}
                className="btn-primary btn-primary--block"
              >
                {isBusy ? <Loader2 className="spinner" /> : <Send />}
                Submit answers
              </button>
            </form>
          )}
        </div>
      )}

      {room.phase === 'judging' && (
        <div className="panel room__judging">
          <Loader2 className="spinner spinner--lg" />
          <p className="room__status-title">The referee is reading</p>
          <p className="room__status-text">
            Every answer is being judged. This takes a few seconds.
          </p>
        </div>
      )}

      {room.phase === 'reveal' && room.results && (
        <div className="room__reveal">
          <div className="panel room__panel">
            <div className="room__leaderboard-head">
              <Trophy />
              <p className="room__section-label">
                Round leaderboard —{' '}
                {room.results.endedBy === 'clock' ? 'time ran out' : 'everyone finished'}
              </p>
            </div>

            <div className="room__rows">
              {room.results.rows.map((row) => (
                <div
                  key={row.playerId}
                  className={`room__row${row.rank === 1 ? ' room__row--winner' : ''}`}
                >
                  <div className="room__row-head">
                    <div className="room__row-identity">
                      <span
                        className={`room__rank${row.rank === 1 ? ' room__rank--winner' : ''}`}
                      >
                        {row.rank}
                        {row.tied ? '=' : ''}
                      </span>
                      <div>
                        <p className="room__row-name">
                          {row.name}
                          {row.playerId === room.youId && (
                            <span className="room__row-you"> (you)</span>
                          )}
                        </p>
                        <p className="room__row-meta">
                          {row.auto ? 'Ran out of time' : `${row.timeTakenSeconds}s`}
                          {row.speedBonus > 0 && ` · +${row.speedBonus} speed`}
                        </p>
                      </div>
                    </div>
                    <span className="room__row-score">{row.totalScore}</span>
                  </div>

                  <div className="room__verdicts">
                    {CATEGORIES.map((category) => {
                      const key = category.key as CategoryKey;
                      const verdict = row.categories[key];
                      return (
                        <div key={key} className="room__verdict">
                          <p className="room__verdict-label">{category.label}</p>
                          <p
                            className={`room__verdict-answer${
                              verdict.valid ? ' room__verdict-answer--valid' : ''
                            }`}
                          >
                            {row.answers[key] || '—'}
                          </p>
                          <p className="room__verdict-points">{verdict.points} pts</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {room.standings.length > 1 && (
            <div className="panel room__panel">
              <p className="room__section-label">
                {room.matchComplete ? 'Final standings' : 'Session standings'} — round{' '}
                {room.roundsPlayed} of {room.totalRounds}
              </p>
              <table className="room__standings-table">
                <tbody>
                  {room.standings.map((row) => (
                    <tr key={row.playerId}>
                      <td className="room__standings-rank">
                        {row.rank}
                        {row.tied ? '=' : ''}
                      </td>
                      <td className="room__standings-name">{row.name}</td>
                      <td className="room__standings-wins">
                        {row.wins} win{row.wins === 1 ? '' : 's'}
                      </td>
                      <td className="room__standings-score">{row.totalScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {room.matchComplete && (
            <div id="room-match-complete" className="room__match-complete">
              <Trophy />
              <h3 className="room__match-title">Match complete</h3>
              <p className="room__match-text">
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
              className="btn-primary btn-primary--block"
            >
              {room.matchComplete ? (
                <>
                  <RotateCcw /> New match
                </>
              ) : (
                <>
                  <Play /> Back to the lobby
                </>
              )}
            </button>
          ) : (
            <p className="room__waiting">
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
