import React, { useState } from 'react';
import { LogIn } from 'lucide-react';
import { RoomFormPanel } from './RoomFormPanel';
import { RoomNameField } from './RoomNameField';

const ROOM_CODE_LENGTH = 4;

interface JoinRoomFormProps {
  name: string;
  onNameChange: (value: string) => void;
  initialCode: string;
  isBusy: boolean;
  error: string | null;
  onBack: () => void;
  onJoin: (name: string, code: string) => void;
}

export const JoinRoomForm: React.FC<JoinRoomFormProps> = ({
  name,
  onNameChange,
  initialCode,
  isBusy,
  error,
  onBack,
  onJoin,
}) => {
  const [code, setCode] = useState(initialCode);

  const trimmedName = name.trim();
  const trimmedCode = code.trim().toUpperCase();

  return (
    <RoomFormPanel
      title="Join a room"
      submitLabel="Join room"
      submitIcon={<LogIn />}
      canSubmit={trimmedName.length > 0 && trimmedCode.length >= ROOM_CODE_LENGTH && !isBusy}
      isBusy={isBusy}
      error={error}
      onBack={onBack}
      onSubmit={() => onJoin(trimmedName, trimmedCode)}
    >
      <RoomNameField value={name} onChange={onNameChange} />

      <div>
        <label htmlFor="landing-code-input" className="field-label landing__label">
          Room code
        </label>
        <input
          id="landing-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD"
          maxLength={ROOM_CODE_LENGTH}
          autoComplete="off"
          className="answer-input landing__code-input"
        />
      </div>
    </RoomFormPanel>
  );
};
