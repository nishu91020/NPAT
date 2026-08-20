import React from 'react';
import { playClickSound } from '../audio';

interface AppFooterProps {
  gamesPlayed: number;
  onOpenHelp: () => void;
  onOpenStats: () => void;
}

export const AppFooter: React.FC<AppFooterProps> = ({ gamesPlayed, onOpenHelp, onOpenStats }) => (
  <footer className="site-footer">
    <div className="site-footer__group">
      <span>LEXICON v1.0.4</span>
      <span className="site-footer__separator">•</span>
      <span>Name • Place • Animal • Thing</span>
    </div>
    <div className="site-footer__group">
      <button
        onClick={() => {
          playClickSound();
          onOpenHelp();
        }}
        className="site-footer__link"
      >
        Rules
      </button>
      <button
        onClick={() => {
          playClickSound();
          onOpenStats();
        }}
        className="site-footer__link"
      >
        My Stats ({gamesPlayed})
      </button>
    </div>
  </footer>
);
