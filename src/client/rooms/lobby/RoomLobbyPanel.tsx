import React from 'react';
import { Loader2, Play, Sparkles } from 'lucide-react';
import type { RoomView } from '../../../shared/contract';
import { ROOM_ROUND_CHOICES } from '../../../shared/contract';
import { playClickSound } from '../../audio';

interface RoomLobbyPanelProps {
  room: RoomView;
  isBusy: boolean;
  onStartRound: () => void;
  onSetRounds: (totalRounds: number) => void;
}

export const RoomLobbyPanel: React.FC<RoomLobbyPanelProps> = ({
  room,
  isBusy,
  onStartRound,
  onSetRounds,
}) => (
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
);
