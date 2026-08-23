import React, { useState } from 'react';
import { ArrowLeft, Check, Copy, Crown, Loader2, Users } from 'lucide-react';
import type { RoomView, UserAnswers } from '../../shared/contract';
import { playClickSound } from '../audio';
import { useRoomRound } from './racing/useRoomRound';
import { RoomStatusMessage } from './RoomStatusMessage';
import { RoomLobbyPanel } from './lobby/RoomLobbyPanel';
import { RoomRacePanel } from './racing/RoomRacePanel';
import { RoomRevealPanel } from './reveal/RoomRevealPanel';

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
  const { answers, setAnswer, timeLeft, youAreRacing, youHaveSubmitted } = useRoomRound(
    room,
    fetchedAtMs,
    onSubmit
  );
  const [copied, setCopied] = useState(false);

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
        <RoomLobbyPanel
          room={room}
          isBusy={isBusy}
          onStartRound={onStartRound}
          onSetRounds={onSetRounds}
        />
      )}

      {room.phase === 'racing' && room.round && (
        <RoomRacePanel
          round={room.round}
          totalRounds={room.totalRounds}
          timeLeft={timeLeft}
          youAreRacing={youAreRacing}
          youHaveSubmitted={youHaveSubmitted}
          answers={answers}
          onAnswerChange={setAnswer}
          isBusy={isBusy}
          onSubmit={onSubmit}
        />
      )}

      {room.phase === 'judging' && (
        <RoomStatusMessage
          className="panel room__judging"
          icon={<Loader2 className="spinner spinner--lg" />}
          title="The referee is reading"
          text="Every answer is being judged. This takes a few seconds."
        />
      )}

      {room.phase === 'reveal' && room.results && (
        <RoomRevealPanel
          room={room}
          results={room.results}
          isBusy={isBusy}
          onNextRound={onNextRound}
          onNewMatch={onNewMatch}
        />
      )}
    </section>
  );
};
