import React from 'react';
import { LogIn, Sparkles, Users } from 'lucide-react';
import { playClickSound } from '../audio';

interface ModeCardProps {
  id: string;
  variant: 'daily' | 'create' | 'join';
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  onSelect: () => void;
}

const ModeCard: React.FC<ModeCardProps> = ({
  id,
  variant,
  icon,
  title,
  description,
  cta,
  onSelect,
}) => (
  <button
    id={id}
    onClick={() => {
      playClickSound();
      onSelect();
    }}
    className={`landing-card landing-card--${variant}`}
  >
    {icon}
    <h3 className="landing-card__title">{title}</h3>
    <p className="landing-card__desc">{description}</p>
    <span className="landing-card__cta">{cta}</span>
  </button>
);

interface LandingModeCardsProps {
  hasPlayedToday: boolean;
  onDailyChallenge: () => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
}

export const LandingModeCards: React.FC<LandingModeCardsProps> = ({
  hasPlayedToday,
  onDailyChallenge,
  onCreateRoom,
  onJoinRoom,
}) => (
  <div className="landing__modes">
    <ModeCard
      id="landing-daily-btn"
      variant="daily"
      icon={<Sparkles />}
      title="Daily Challenge"
      description={
        hasPlayedToday
          ? "You've played today — review your round."
          : 'Play today, Keeps your streak alive.'
      }
      cta="Play now →"
      onSelect={onDailyChallenge}
    />

    <ModeCard
      id="landing-create-room-btn"
      variant="create"
      icon={<Users />}
      title="Create Room"
      description="Start a room, share the code, and race the same letter along with friends."
      cta="Start a room →"
      onSelect={onCreateRoom}
    />

    <ModeCard
      id="landing-join-room-btn"
      variant="join"
      icon={<LogIn />}
      title="Join Room"
      description="Got a code from a friend? Enter it and take your seat."
      cta="Enter a code →"
      onSelect={onJoinRoom}
    />
  </div>
);
