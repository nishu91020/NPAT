import React from 'react';
import { Trophy } from 'lucide-react';
import type { RoomResults } from '../../../shared/contract';
import { RoomScoreCard } from './RoomScoreCard';

interface RoomRoundLeaderboardProps {
  results: RoomResults;
  youId: string;
}

export const RoomRoundLeaderboard: React.FC<RoomRoundLeaderboardProps> = ({ results, youId }) => (
  <div className="panel room__panel">
    <div className="room__leaderboard-head">
      <Trophy />
      <p className="room__section-label">
        Round leaderboard — {results.endedBy === 'clock' ? 'time ran out' : 'everyone finished'}
      </p>
    </div>

    <div className="room__rows">
      {results.rows.map((row) => (
        <RoomScoreCard key={row.playerId} row={row} youId={youId} />
      ))}
    </div>
  </div>
);
