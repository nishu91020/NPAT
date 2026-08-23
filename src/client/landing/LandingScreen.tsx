import React, { useState } from 'react';
import { playClickSound } from '../audio';
import { LandingHero } from './LandingHero';
import { LandingModeCards } from './LandingModeCards';
import { CreateRoomForm } from '../rooms/forms/CreateRoomForm';
import { JoinRoomForm } from '../rooms/forms/JoinRoomForm';

type RoomIntent = 'create' | 'join';

interface LandingScreenProps {
  hasPlayedToday: boolean;
  playerName: string;

  initialCode: string;
  isBusy: boolean;
  error: string | null;
  onDailyChallenge: () => void;
  onCreateRoom: (name: string) => void;
  onJoinRoom: (name: string, code: string) => void;
  onDismissError: () => void;
}

export const LandingScreen: React.FC<LandingScreenProps> = ({
  hasPlayedToday,
  playerName,
  initialCode,
  isBusy,
  error,
  onDailyChallenge,
  onCreateRoom,
  onJoinRoom,
  onDismissError,
}) => {
  const [intent, setIntent] = useState<RoomIntent | null>(initialCode ? 'join' : null);
  const [name, setName] = useState(playerName);

  const open = (next: RoomIntent) => {
    playClickSound();
    onDismissError();
    setIntent(next);
  };

  const close = () => {
    playClickSound();
    onDismissError();
    setIntent(null);
  };

  return (
    <section id="landing-screen" className="landing">
      <LandingHero hasPlayedToday={hasPlayedToday} />

      {intent === null && (
        <LandingModeCards
          hasPlayedToday={hasPlayedToday}
          onDailyChallenge={onDailyChallenge}
          onCreateRoom={() => open('create')}
          onJoinRoom={() => open('join')}
        />
      )}

      {intent === 'create' && (
        <CreateRoomForm
          name={name}
          onNameChange={setName}
          isBusy={isBusy}
          error={error}
          onBack={close}
          onCreate={onCreateRoom}
        />
      )}

      {intent === 'join' && (
        <JoinRoomForm
          name={name}
          onNameChange={setName}
          initialCode={initialCode}
          isBusy={isBusy}
          error={error}
          onBack={close}
          onJoin={onJoinRoom}
        />
      )}
    </section>
  );
};
