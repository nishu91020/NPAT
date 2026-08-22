import React from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { playClickSound } from '../audio';

interface RoomFormPanelProps {
  title: string;
  submitLabel: string;
  submitIcon: React.ReactNode;
  canSubmit: boolean;
  isBusy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
}

export const RoomFormPanel: React.FC<RoomFormPanelProps> = ({
  title,
  submitLabel,
  submitIcon,
  canSubmit,
  isBusy,
  error,
  onBack,
  onSubmit,
  children,
}) => (
  <form
    id="landing-room-form"
    className="panel landing__form"
    onSubmit={(e) => {
      e.preventDefault();
      playClickSound();
      if (canSubmit) onSubmit();
    }}
  >
    <div className="landing__form-head">
      <button
        type="button"
        id="landing-room-back-btn"
        onClick={onBack}
        className="btn-outline btn-outline--compact"
      >
        <ArrowLeft /> Back
      </button>
      <h3 className="landing__form-title">{title}</h3>
    </div>

    {children}

    {error && (
      <div id="landing-room-error" role="alert" className="alert alert--error">
        {error}
      </div>
    )}

    <button
      id="landing-room-submit-btn"
      type="submit"
      disabled={!canSubmit}
      className="btn-primary landing__submit"
    >
      {isBusy ? <Loader2 className="spinner" /> : submitIcon}
      {submitLabel}
    </button>
  </form>
);
