import React from 'react';
import { Play, RotateCcw, Trophy } from 'lucide-react';
import type { RoomResults, RoomStandingRow, RoomView } from '../../../shared/contract';
import { playClickSound } from '../../audio';
import { RoomRoundLeaderboard } from './RoomRoundLeaderboard';

function championLineFor(standings: RoomStandingRow[]): string {
  const champions = standings.filter((row) => row.rank === 1).map((row) => row.name);
  if (champions.length === 0) return '.';
  if (champions.length === 1) return ` — ${champions[0]} takes it.`;
  return ` — ${champions.slice(0, -1).join(', ')} and ${champions[champions.length - 1]} tie it.`;
}

interface RoomRevealPanelProps {
  room: RoomView;
  results: RoomResults;
  isBusy: boolean;
  onNextRound: () => void;
  onNewMatch: () => void;
}

export const RoomRevealPanel: React.FC<RoomRevealPanelProps> = ({
  room,
  results,
  isBusy,
  onNextRound,
  onNewMatch,
}) => (
  <div className="room__reveal">
    <RoomRoundLeaderboard results={results} youId={room.youId} />

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
          {championLineFor(room.standings)}
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
);
