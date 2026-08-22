import React from 'react';
import { Users } from 'lucide-react';
import { RoomFormPanel } from './RoomFormPanel';
import { RoomNameField } from './RoomNameField';

interface CreateRoomFormProps {
  name: string;
  onNameChange: (value: string) => void;
  isBusy: boolean;
  error: string | null;
  onBack: () => void;
  onCreate: (name: string) => void;
}

export const CreateRoomForm: React.FC<CreateRoomFormProps> = ({
  name,
  onNameChange,
  isBusy,
  error,
  onBack,
  onCreate,
}) => {
  const trimmedName = name.trim();

  return (
    <RoomFormPanel
      title="Create a room"
      submitLabel="Create room"
      submitIcon={<Users />}
      canSubmit={trimmedName.length > 0 && !isBusy}
      isBusy={isBusy}
      error={error}
      onBack={onBack}
      onSubmit={() => onCreate(trimmedName)}
    >
      <RoomNameField value={name} onChange={onNameChange} />
    </RoomFormPanel>
  );
};
