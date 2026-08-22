import React from 'react';
import { X, HelpCircle, Sparkles, CheckCircle2, Trophy, Clock, Share2 } from 'lucide-react';
import { playClickSound } from '../audio';

interface HelpRulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpRulesModal: React.FC<HelpRulesModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal modal--scrollable">
        <button
          onClick={() => {
            playClickSound();
            onClose();
          }}
          className="modal__close"
        >
          <X />
        </button>

        <div className="modal__header">
          <div className="modal__badge">
            <HelpCircle />
          </div>
          <div>
            <h3 className="modal__title">How to Play</h3>
            <p className="modal__subtitle">Name • Place • Animal • Thing Game Rules</p>
          </div>
        </div>

        <div className="help-modal__body">
          <div className="help-step">
            <span className="help-step__number">1</span>
            <div>
              <h4 className="help-step__title">Daily Target Letter</h4>
              <p>
                All 4 entries (Name, Place, Animal, Thing) must strictly start with today's assigned letter.
              </p>
            </div>
          </div>

          <div className="help-step">
            <span className="help-step__number help-step__number--indigo">2</span>
            <div>
              <h4 className="help-step__title">Timer & Lives</h4>
              <p>
                Complete your entries before the timer expires. Letting time run out costs 1 life. Submitting early awards speed bonus points!
              </p>
            </div>
          </div>

          <div className="help-step help-step--highlight">
            <span className="help-step__number help-step__number--amber">3</span>
            <div>
              <h4 className="help-step__title">
                <Sparkles className="help-step__title-icon--amber" /> Daily Bonus Challenge (+5 Pts Each)
              </h4>
              <p>
                Fulfill the special rule (e.g. 6+ letters, regional connections, specific themes) for extra points per category!
              </p>
            </div>
          </div>

          <div className="help-step">
            <span className="help-step__number">4</span>
            <div>
              <h4 className="help-step__title">
                <Share2 className="help-step__title-icon--indigo" /> Shareable Grid & Daily Streaks
              </h4>
              <p>
                AI scores each entry. Copy your grid result card to share your daily score and maintain your active streak!
              </p>
            </div>
          </div>
        </div>

        <div className="modal__footer">
          <button
            onClick={() => {
              playClickSound();
              onClose();
            }}
            className="modal__action modal__action--indigo"
          >
            Got It, Let's Play!
          </button>
        </div>
      </div>
    </div>
  );
};

