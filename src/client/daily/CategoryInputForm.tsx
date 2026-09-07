import React, { useState, useEffect, useRef } from 'react';
import { UserAnswers, DailyPuzzle, CategoryKey } from '../../shared/contract';
import { CATEGORIES } from '../categories';
import { User, MapPin, Dog, Package, Clock, Heart, Send, Sparkles, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { playTickSound, playClickSound } from '../audio';

interface CategoryInputFormProps {
  puzzle: DailyPuzzle;
  onSubmit: (answers: UserAnswers, timeTaken: number, remainingLives: number) => void;
  isSubmitting: boolean;
}

const CATEGORY_NUMBERS: Record<CategoryKey, string> = {
  name: '01. Name',
  place: '02. Place',
  animal: '03. Animal',
  thing: '04. Thing',
};

export const CategoryInputForm: React.FC<CategoryInputFormProps> = ({
  puzzle,
  onSubmit,
  isSubmitting,
}) => {
  const [answers, setAnswers] = useState<UserAnswers>({
    name: '',
    place: '',
    animal: '',
    thing: '',
  });

  const [timeLeft, setTimeLeft] = useState<number>(puzzle.timeLimitSeconds);
  const [lives, setLives] = useState<number>(3);
  const [timerActive, setTimerActive] = useState<boolean>(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const targetLetter = puzzle.letter.toUpperCase();

  const startedAtRef = useRef<number>(Date.now());

  function elapsedSeconds(): number {
    return Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
  }

  useEffect(() => {
    setAnswers({ name: '', place: '', animal: '', thing: '' });    setTimeLeft(puzzle.timeLimitSeconds);
    setLives(3);
    setTimerActive(true);
    setValidationError(null);
    startedAtRef.current = Date.now();
  }, [puzzle]);

  useEffect(() => {
    if (!timerActive || isSubmitting) return;

    if (timeLeft <= 0) {
      setTimerActive(false);
      handleTimeOut();
      return;
    }

    if (timeLeft <= 10 && timeLeft > 0) {
      playTickSound();
    }

    timerRef.current = setTimeout(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timeLeft, timerActive, isSubmitting]);

  const handleTimeOut = () => {
    if (lives > 1) {
      setLives((l) => l - 1);
      setValidationError(`Time expired! You lost 1 life (${lives - 1} remaining). Adding +15s bonus time!`);
      setTimeLeft(15);
      setTimerActive(true);
    } else {
      setLives(0);
      setValidationError('Game Over! Time ran out. Submitting current entries...');
      onSubmit(answers, elapsedSeconds(), 0);
    }
  };

  const handleInputChange = (key: CategoryKey, val: string) => {
    setValidationError(null);
    setAnswers((prev) => ({
      ...prev,
      [key]: val,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const filledCount = (Object.values(answers) as string[]).filter((v) => v.trim().length > 0).length;
    if (filledCount === 0) {
      setValidationError(`Please fill out at least one category starting with "${targetLetter}".`);
      return;
    }

    setTimerActive(false);
    onSubmit(answers, elapsedSeconds(), lives);
  };

  const getLetterStatus = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const startsWith = trimmed.charAt(0).toUpperCase() === targetLetter;
    return startsWith;
  };

  const timerPercent = (timeLeft / puzzle.timeLimitSeconds) * 100;
  const timerToneClass =
    timeLeft > 30 ? '' : timeLeft > 10 ? ' timer-bar--warning' : ' timer-bar--danger';

  return (
    <form
      id="npat-input-form"
      onSubmit={handleSubmit}
      className="panel panel--shadow category-form"
    >
      <div className="category-form__status">
        <div className="category-form__timer">
          <p className="category-form__timer-label">Time Remaining</p>
          <div className="category-form__timer-row">
            <span
              className={`category-form__clock${timeLeft <= 10 ? ' category-form__clock--urgent' : ''}`}
            >
              00:{timeLeft < 10 ? `0${timeLeft}` : timeLeft}
            </span>
            <progress
              className={`timer-bar${timerToneClass}`}
              max={100}
              value={Math.max(0, Math.min(100, timerPercent))}
              aria-label="Time remaining"
            />
          </div>
        </div>

        <div className="category-form__lives">
          <p className="category-form__lives-label">Lives Remaining</p>
          <div className="category-form__life-row">
            {[1, 2, 3].map((num) => (
              <div
                key={num}
                className={`category-form__life ${
                  num <= lives ? 'category-form__life--filled' : 'category-form__life--empty'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {validationError && (
        <div className="alert alert--warning">
          <AlertCircle />
          <span>{validationError}</span>
        </div>
      )}

      <div className="category-form__fields">
        {CATEGORIES.map((cat) => {
          const val = answers[cat.key];
          const status = getLetterStatus(val);

          return (
            <div key={cat.key}>
              <div className="category-form__field-head">
                <label htmlFor={`input-${cat.key}`} className="field-label">
                  {CATEGORY_NUMBERS[cat.key]}
                </label>

                {status === true && (
                  <span className="category-form__flag category-form__flag--ok">
                    <Check /> Starts with {targetLetter}
                  </span>
                )}
                {status === false && (
                  <span className="category-form__flag category-form__flag--bad">
                    Must start with "{targetLetter}"
                  </span>
                )}
              </div>

              <input
                id={`input-${cat.key}`}
                type="text"
                value={val}
                onChange={(e) => handleInputChange(cat.key, e.target.value)}
                placeholder={`${cat.label.toUpperCase()} STARTING WITH '${targetLetter}'...`}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className={`answer-input category-form__input${
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
      </div>

      <div className="category-form__actions">
        <button
          type="button"
          onClick={() => {
            playClickSound();
            setAnswers({ name: '', place: '', animal: '', thing: '' });
          }}
          className="category-form__clear"
        >
          <RefreshCw /> Clear All
        </button>

        <button
          id="submit-answers-btn"
          type="submit"
          disabled={isSubmitting}
          onClick={() => playClickSound()}
          className="btn-primary btn-primary--lift category-form__submit"
        >
          {isSubmitting ? (
            <>
              <div className="spinner-ring" />
              <span>Verifying Answers...</span>
            </>
          ) : (
            <>
              <Send />
              <span>Submit Today's Set</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
};
