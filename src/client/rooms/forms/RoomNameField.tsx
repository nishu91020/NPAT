import React from 'react';

interface RoomNameFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export const RoomNameField: React.FC<RoomNameFieldProps> = ({ value, onChange }) => (
  <div>
    <label htmlFor="landing-name-input" className="field-label landing__label">
      Your name
    </label>
    <input
      id="landing-name-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="WHAT SHOULD WE CALL YOU?"
      maxLength={20}
      autoFocus
      autoComplete="off"
      className="answer-input"
    />
  </div>
);
