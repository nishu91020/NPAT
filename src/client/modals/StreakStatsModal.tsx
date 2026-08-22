import React from 'react';
import { GameStats, GameResult } from '../types';
import { X, Flame, Trophy, Target, BarChart2, Calendar, Sparkles } from 'lucide-react';
import { playClickSound } from '../audio';

interface StreakStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: GameStats;
}

export const StreakStatsModal: React.FC<StreakStatsModalProps> = ({ isOpen, onClose, stats }) => {
  if (!isOpen) return null;

  const winRate = stats.gamesPlayed > 0 ? Math.round((stats.wins / stats.gamesPlayed) * 100) : 0;
  const avgScore = stats.gamesPlayed > 0 ? Math.round(stats.totalScore / stats.gamesPlayed) : 0;
  const historyList = (Object.values(stats.history) as GameResult[]).reverse().slice(0, 10);

  return (
    <div className="modal-overlay">
      <div className="modal">
        <button
          onClick={() => {
            playClickSound();
            onClose();
          }}
          className="modal__close"
        >
          <X />
        </button>

        <div className="modal__header">
          <div className="modal__badge">
            <Trophy />
          </div>
          <div>
            <h3 className="modal__title">Your Statistics & Streaks</h3>
            <p className="modal__subtitle">Track your daily progress & performance</p>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stats-card stats-card--streak">
            <Flame className="stats-card__icon--streak" />
            <p className="stats-card__value stats-card__value--streak">{stats.currentStreak}</p>
            <p className="stats-card__label stats-card__label--streak">Streak</p>
          </div>

          <div className="stats-card">
            <Trophy className="stats-card__icon--best" />
            <p className="stats-card__value">{stats.maxStreak}</p>
            <p className="stats-card__label">Best</p>
          </div>

          <div className="stats-card">
            <Target className="stats-card__icon--rate" />
            <p className="stats-card__value">{winRate}%</p>
            <p className="stats-card__label">Win Rate</p>
          </div>

          <div className="stats-card">
            <BarChart2 className="stats-card__icon--average" />
            <p className="stats-card__value">{avgScore}</p>
            <p className="stats-card__label">Avg Pts</p>
          </div>
        </div>

        <div>
          <h4 className="stats-history__heading">
            <Calendar />
            Recent Game History
          </h4>

          {historyList.length === 0 ? (
            <div className="stats-history__empty">
              No games completed yet. Play today's puzzle to build your streak!
            </div>
          ) : (
            <div className="stats-history__list">
              {historyList.map((item, idx) => (
                <div key={idx} className="stats-history__row">
                  <div className="stats-history__identity">
                    <span className="stats-history__letter">{item.letter}</span>
                    <div>
                      <p className="stats-history__label">
                        {item.mode === 'practice' ? 'Practice' : `Challenge #${item.dayNumber}`}
                      </p>
                      <p className="stats-history__date">{item.completedAt.split('T')[0]}</p>
                    </div>
                  </div>

                  <div className="stats-history__result">
                    <span className="stats-history__score">{item.score} Pts</span>
                    <p className="stats-history__time">{item.timeTaken}s</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button
            onClick={() => {
              playClickSound();
              onClose();
            }}
            className="modal__action modal__action--dark"
          >
            Close Stats
          </button>
        </div>
      </div>
    </div>
  );
};

