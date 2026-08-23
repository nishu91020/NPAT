import React from 'react';
import { Loader2, Send } from 'lucide-react';
import type { CategoryKey, UserAnswers } from '../../../shared/contract';
import { CATEGORIES } from '../../categories';
import { playClickSound } from '../../audio';

interface RoomAnswerFormProps {
  targetLetter: string;
  answers: UserAnswers;
  onAnswerChange: (key: CategoryKey, value: string) => void;
  isBusy: boolean;
  onSubmit: (answers: UserAnswers) => void;
}

export const RoomAnswerForm: React.FC<RoomAnswerFormProps> = ({
  targetLetter,
  answers,
  onAnswerChange,
  isBusy,
  onSubmit,
}) => {
  const letterStatus = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || !targetLetter) return null;
    return trimmed.charAt(0).toUpperCase() === targetLetter;
  };

  return (
    <form
      id="room-answers-form"
      onSubmit={(e) => {
        e.preventDefault();
        playClickSound();
        onSubmit(answers);
      }}
      className="room__form"
    >
      {CATEGORIES.map((category) => {
        const key = category.key as CategoryKey;
        const status = letterStatus(answers[key]);
        return (
          <div key={key}>
            <label htmlFor={`room-input-${key}`} className="field-label room__label">
              {category.label}
            </label>
            <input
              id={`room-input-${key}`}
              value={answers[key]}
              onChange={(e) => onAnswerChange(key, e.target.value)}
              placeholder={`${category.label.toUpperCase()} WITH '${targetLetter}'...`}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className={`answer-input room__input${
                status === true
                  ? ' answer-input--valid'
                  : status === false
                    ? ' answer-input--invalid'
                    : ''
              }`}
            />
          </div>
        );
      })}

      <button
        id="room-submit-btn"
        type="submit"
        disabled={isBusy}
        className="btn-primary btn-primary--block"
      >
        {isBusy ? <Loader2 className="spinner" /> : <Send />}
        Submit answers
      </button>
    </form>
  );
};
