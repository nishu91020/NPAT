import React from 'react';
import { Check } from 'lucide-react';

interface LandingHeroProps {
  hasPlayedToday: boolean;
}

export const LandingHero: React.FC<LandingHeroProps> = ({ hasPlayedToday }) => (
  <div className="panel panel--shadow landing__hero">
    <p className="landing__eyebrow">Name • Place • Animal • Thing</p>
    <h2 className="landing__title">
      One letter. Four answers.
      <br />
      Sixty seconds.
    </h2>
    <p className="landing__lede">
      A new letter every day, judged by an AI referee. Play it on your own, or start a room and race
      your friends through the same letter at the same time.
    </p>

    {hasPlayedToday && (
      <div className="landing__badges">
        <span className="chip chip--done">
          <Check /> Today complete
        </span>
      </div>
    )}
  </div>
);
