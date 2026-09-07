import React, { useState } from 'react';
import { GameResult } from '../types';
import { generateShareCard } from './shareCard';
import { isAiJudged } from './judgedBy';
import { Trophy, Share2, Copy, Check, Sparkles, Flame, ArrowRight, User, MapPin, Dog, Package, Award, Lightbulb } from 'lucide-react';
import { playClickSound, playSuccessSound } from '../audio';

interface ValidationResultCardProps {
  result: GameResult;
  onViewStats: () => void;
}

const CATEGORY_NAMES = {
  name: 'Name',
  place: 'Place',
  animal: 'Animal',
  thing: 'Thing',
};

export const ValidationResultCard: React.FC<ValidationResultCardProps> = ({
  result,
  onViewStats,
}) => {
  const [copied, setCopied] = useState(false);

  const shareText = generateShareCard(
    result.dayNumber,
    result.letter,
    result.validation.totalScore,
    result.streak,
    result.validation.categories
  );

  const handleCopy = () => {
    playClickSound();
    playSuccessSound();
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const isWin = result.validation.totalScore >= 20;

  return (
    <div id="validation-result-card" className="panel panel--shadow result-card">
      <div className="result-card__head">
        <div className="result-card__summary">
          <div className="result-card__score">{result.validation.totalScore}</div>
          <div>
            <div className="result-card__tags">
              <span className="result-card__tag-day">Challenge #{result.dayNumber}</span>
              <span className="result-card__tag-letter">Letter '{result.letter}'</span>
              {isAiJudged(result.validation.judgedBy) && (
                <span className="result-card__tag-referee">
                  <Sparkles />
                  AI Referee
                </span>
              )}
            </div>
            <h2 className="result-card__verdict">
              {isWin ? 'Set Validated! 🎉' : 'Keep Practicing! 👍'}
            </h2>
            <p className="result-card__feedback">{result.validation.overallFeedback}</p>
          </div>
        </div>

        <div className="result-card__streak">
          <Flame />
          <div>
            <p className="result-card__streak-label">Current Streak</p>
            <p className="result-card__streak-value">{result.streak} Days 🔥</p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="result-card__section-title">
          <Sparkles />
          Category Evaluation Breakdown
        </h3>

        <div className="result-card__grid">
          {(['name', 'place', 'animal', 'thing'] as const).map((key) => {
            const item = result.validation.categories[key];
            const answerWord = result.answers[key] || '(No Entry)';
            const tone = item.valid
              ? item.bonusMatched
                ? 'result-tile--bonus'
                : 'result-tile--valid'
              : 'result-tile--invalid';

            return (
              <div key={key} className={`result-tile ${tone}`}>
                <div className="result-tile__head">
                  <span className="result-tile__category">{CATEGORY_NAMES[key]}</span>

                  <div className="result-tile__badges">
                    {item.bonusMatched && <span className="result-tile__bonus">+5 Bonus!</span>}
                    <span
                      className={`result-tile__points${
                        item.valid ? ' result-tile__points--scored' : ''
                      }`}
                    >
                      +{item.points} Pts
                    </span>
                  </div>
                </div>

                <p className="result-tile__answer">"{answerWord}"</p>

                <p className="result-tile__feedback">{item.feedback}</p>

                {item.suggestion && (
                  <p
                    className={`result-tile__suggestion${
                      item.valid ? ' result-tile__suggestion--bonus' : ''
                    }`}
                  >
                    <Lightbulb />
                    <span>
                      {item.valid ? 'Bonus:' : 'Try:'}{' '}
                      <span className="result-tile__suggestion-word">{item.suggestion}</span>
                    </span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="result-card__totals">
        <div className="result-card__totals-speed">
          <Award />
          <span>
            Speed Bonus: <strong>+{result.validation.speedBonus} Pts</strong> ({result.timeTaken}s
            taken)
          </span>
        </div>
        <div className="result-card__totals-score">
          <span>
            Total Score: <strong>{result.validation.totalScore} Pts</strong>
          </span>
        </div>
      </div>

      <div className="result-card__share">
        <div className="result-card__share-head">
          <span className="result-card__share-label">
            <Share2 />
            Shareable Results Card
          </span>

          <button id="copy-share-card-btn" onClick={handleCopy} className="result-card__copy">
            {copied ? (
              <>
                <Check />
                <span>Copied to Clipboard!</span>
              </>
            ) : (
              <>
                <Copy />
                <span>Copy Result Card</span>
              </>
            )}
          </button>
        </div>

        <pre className="result-card__share-text">{shareText}</pre>
      </div>

      <div className="result-card__actions">
        <button
          onClick={() => {
            playClickSound();
            onViewStats();
          }}
          className="result-card__stats-btn"
        >
          View Streaks & Stats
        </button>
      </div>
    </div>
  );
};

