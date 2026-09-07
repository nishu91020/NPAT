import React from 'react';
import { DailyPuzzle } from '../../shared/contract';
import { Sparkles, Calendar, Clock, Award, Flag, Utensils, Globe, TreePine, Layers } from 'lucide-react';

interface LetterBannerProps {
  puzzle: DailyPuzzle;
  hasPlayedToday?: boolean;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  Sparkles: <Sparkles className="bonus-icon--indigo" />,
  Flag: <Flag className="bonus-icon--amber" />,
  Utensils: <Utensils className="bonus-icon--emerald" />,
  Globe: <Globe className="bonus-icon--indigo" />,
  TreePine: <TreePine className="bonus-icon--emerald" />,
  Layers: <Layers className="bonus-icon--indigo" />,
  Award: <Award className="bonus-icon--gold" />,
};

export const LetterBanner: React.FC<LetterBannerProps> = ({ puzzle, hasPlayedToday }) => {
  return (
    <div id="letter-banner-card" className="panel panel--shadow letter-banner">
      <div className="letter-banner__row">
        <div className="letter-banner__identity">
          <div className="letter-banner__letter">{puzzle.letter}</div>

          <div>
            <div className="letter-banner__meta">
              <span className="letter-banner__day">Challenge #{puzzle.dayNumber}</span>
              <span className="letter-banner__date">
                <Calendar />
                {puzzle.dateString}
              </span>
            </div>

            <h2 className="letter-banner__title">
              Today's Letter{' '}
              <span className="letter-banner__title-letter">"{puzzle.letter}"</span>
            </h2>

            <p className="letter-banner__hint">
              <Clock />
              Fill out Name, Place, Animal, Thing before the timer runs out!
            </p>
          </div>
        </div>

        <div className="letter-banner__bonus">
          <div className="letter-banner__bonus-head">
            <span className="letter-banner__bonus-label">
              <Sparkles />
              Bonus Challenge (+5 Pts Each)
            </span>
          </div>

          <div className="letter-banner__bonus-body">
            <div className="letter-banner__bonus-icon">
              {ICON_MAP[puzzle.bonusChallenge.icon] || <Sparkles className="bonus-icon--gold" />}
            </div>

            <div>
              <h4 className="letter-banner__bonus-title">{puzzle.bonusChallenge.title}</h4>
              <p className="letter-banner__bonus-desc">{puzzle.bonusChallenge.description}</p>
            </div>
          </div>
        </div>
      </div>

      {hasPlayedToday && (
        <div className="letter-banner__complete">
          <span>✓ Today's puzzle complete! Come back tomorrow for a new letter.</span>
        </div>
      )}
    </div>
  );
};

