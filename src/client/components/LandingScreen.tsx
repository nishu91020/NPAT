import React, { useState } from 'react';
import { Sparkles, Users, LogIn, Check, ArrowLeft, Loader2 } from 'lucide-react';
import { playClickSound } from '../audio';

type RoomIntent = 'create' | 'join';

interface LandingScreenProps {
  hasPlayedToday: boolean;
  playerName: string;

  initialCode: string;
  isBusy: boolean;
  error: string | null;
  onDailyChallenge: () => void;
  onCreateRoom: (name: string) => void;
  onJoinRoom: (name: string, code: string) => void;
  onDismissError: () => void;
}

export const LandingScreen: React.FC<LandingScreenProps> = ({
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
    <section id="landing-screen" className="landing">
      <div className="panel panel--shadow landing__hero">
        <p className="landing__eyebrow">Name • Place • Animal • Thing</p>
        <h2 className="landing__title">
          One letter. Four answers.
          <br />
          Sixty seconds.
        </h2>
        <p className="landing__lede">
          A new letter every day, judged by an AI referee. Play it on your own, or start a room and
          race your friends through the same letter at the same time.
        </p>

        {hasPlayedToday && (
          <div className="landing__badges">
            <span className="chip chip--done">
              <Check /> Today complete
            </span>
          </div>
        )}
      </div>

      {intent === null ? (
        <div className="landing__modes">
          <button
            id="landing-daily-btn"
            onClick={() => {
              playClickSound();
              onDailyChallenge();
            }}
            className="landing-card landing-card--daily"
          >
            <Sparkles />
            <h3 className="landing-card__title">Daily Challenge</h3>
            <p className="landing-card__desc">
              {hasPlayedToday
                ? "You've played today — review your round."
                : "Play today, Keeps your streak alive."}
            </p>
            <span className="landing-card__cta">Play now →</span>
          </button>

          <button
            id="landing-create-room-btn"
            onClick={() => open('create')}
            className="landing-card landing-card--create"
          >
            <Users />
            <h3 className="landing-card__title">Create Room</h3>
            <p className="landing-card__desc">
              Start a room, share the code, and race the same letter together.
            </p>
            <span className="landing-card__cta">Start a room →</span>
          </button>

          <button
            id="landing-join-room-btn"
            onClick={() => open('join')}
            className="landing-card landing-card--join"
          >
            <LogIn />
            <h3 className="landing-card__title">Join Room</h3>
            <p className="landing-card__desc">
              Got a code from a friend? Enter it and take your seat.
            </p>
            <span className="landing-card__cta">Enter a code →</span>
          </button>
        </div>
      ) : (
        <form id="landing-room-form" onSubmit={submit} className="panel landing__form">
          <div className="landing__form-head">
            <button
              type="button"
              id="landing-room-back-btn"
              onClick={close}
              className="btn-outline btn-outline--compact"
            >
              <ArrowLeft /> Back
            </button>
            <h3 className="landing__form-title">
              {intent === 'create' ? 'Create a room' : 'Join a room'}
            </h3>
          </div>

          <div>
            <label htmlFor="landing-name-input" className="field-label landing__label">
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
              className="answer-input"
            />
          </div>

          {intent === 'join' && (
            <div>
              <label htmlFor="landing-code-input" className="field-label landing__label">
                Room code
              </label>
              <input
                id="landing-code-input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABCD"
                maxLength={4}
                autoComplete="off"
                className="answer-input landing__code-input"
              />
            </div>
          )}

          {error && (
            <div id="landing-room-error" role="alert" className="alert alert--error">
              {error}
            </div>
          )}

          <button
            id="landing-room-submit-btn"
            type="submit"
            disabled={!canSubmit}
            className="btn-primary landing__submit"
          >
            {isBusy ? (
              <Loader2 className="spinner" />
            ) : intent === 'create' ? (
              <Users />
            ) : (
              <LogIn />
            )}
            {intent === 'create' ? 'Create room' : 'Join room'}
          </button>
        </form>
      )}
    </section>
  );
};
