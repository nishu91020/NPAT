import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { CategoryKey, RoomRound, UserAnswers } from '../../../shared/contract';
import { RoomAnswerForm } from './RoomAnswerForm';
import { RoomStatusMessage } from '../RoomStatusMessage';

interface RoomRacePanelProps {
  round: RoomRound;
  totalRounds: number;
  timeLeft: number;
  youAreRacing: boolean;
  youHaveSubmitted: boolean;
  answers: UserAnswers;
  onAnswerChange: (key: CategoryKey, value: string) => void;
  isBusy: boolean;
  onSubmit: (answers: UserAnswers) => void;
}

export const RoomRacePanel: React.FC<RoomRacePanelProps> = ({
  round,
  totalRounds,
  timeLeft,
  youAreRacing,
  youHaveSubmitted,
  answers,
  onAnswerChange,
  isBusy,
  onSubmit,
}) => {
  const targetLetter = (round.letter ?? '').toUpperCase();

  return (
    <div className="panel room__race">
      <div className="room__race-head">
        <div className="room__race-identity">
          <div className="room__letter">{targetLetter}</div>
          <div>
            <p className="room__round-label">
              Round {round.number} of {totalRounds}
            </p>
            <p className="room__bonus-title">{round.bonusChallenge.title}</p>
            <p className="room__bonus-desc">{round.bonusChallenge.description}</p>
          </div>
        </div>
        <div className="room__timer">
          <p className="room__timer-label">Time remaining</p>
          <p className={`room__timer-value${timeLeft <= 10 ? ' room__timer-value--urgent' : ''}`}>
            00:{timeLeft < 10 ? `0${timeLeft}` : timeLeft}
          </p>
        </div>
      </div>

      {!youAreRacing ? (
        <p className="room__notice">
          You joined after this round started — you are in for the next one.
        </p>
      ) : youHaveSubmitted ? (
        <RoomStatusMessage
          icon={<Check className="room__status-icon--done" />}
          title="Answers in"
          text="Waiting for everyone else — or for the clock."
        />
      ) : timeLeft <= 0 ? (
        <RoomStatusMessage
          icon={<Loader2 className="spinner spinner--lg" />}
          title="Time — sending your answers"
          text="Whatever you had typed goes in as it stands."
        />
      ) : (
        <RoomAnswerForm
          targetLetter={targetLetter}
          answers={answers}
          onAnswerChange={onAnswerChange}
          isBusy={isBusy}
          onSubmit={onSubmit}
        />
      )}
    </div>
  );
};
