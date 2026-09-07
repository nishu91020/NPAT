import React from 'react';
import type { CategoryKey, RoomScoreRow } from '../../../shared/contract';
import { CATEGORIES } from '../../categories';

interface RoomScoreCardProps {
  row: RoomScoreRow;
  youId: string;
}

export const RoomScoreCard: React.FC<RoomScoreCardProps> = ({ row, youId }) => (
  <div className={`room__row${row.rank === 1 ? ' room__row--winner' : ''}`}>
    <div className="room__row-head">
      <div className="room__row-identity">
        <span className={`room__rank${row.rank === 1 ? ' room__rank--winner' : ''}`}>
          {row.rank}
          {row.tied ? '=' : ''}
        </span>
        <div>
          <p className="room__row-name">
            {row.name}
            {row.playerId === youId && <span className="room__row-you"> (you)</span>}
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
);
