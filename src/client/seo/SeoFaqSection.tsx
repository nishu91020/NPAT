import React, { useState } from 'react';
import { ChevronDown, ChevronUp, BookOpen, HelpCircle, Trophy, Sparkles } from 'lucide-react';

export const SeoFaqSection: React.FC = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  const faqs = [
    {
      q: 'What is the Name, Place, Animal, Thing (NPAT) game?',
      a: 'Name, Place, Animal, Thing is a popular worldwide vocabulary game. Players are given a target letter (like "M" or "S") and must quickly come up with four valid entries starting with that letter across four categories: a Person\'s Name, a Geographic Place, an Animal species, and an everyday Object/Thing.',
    },
    {
      q: 'How does Letters Daily work?',
      a: 'Letters Daily generates a new official letter every midnight, along with a special Daily Twist rule (such as requiring 6+ letter words or specific themes). Fill out all 4 entries before the 60-second timer runs out. Our AI instantly validates your entries and awards points based on validity, bonus twists, and speed!',
    },
    {
      q: 'How are points and streaks calculated?',
      a: 'Each valid answer earns base points. Bonus twists add +5 extra points per category. Submitting quickly earns up to +20 Speed Bonus points. Completing the daily official puzzle increases your consecutive Daily Streak.',
    },
    {
      q: 'Can I play more than one round a day?',
      a: 'The official puzzle is one letter a day, played once — that is what the streak is built on. To keep playing, start a multiplayer room and race friends: each room round draws its own letter and bonus rule, and room results never affect your daily streak.',
    },
    {
      q: 'Is Letters Daily mobile-friendly?',
      a: 'Absolutely! Letters Daily is fully optimized for mobile smartphones, tablets, and desktop browsers with responsive layouts, large touch-friendly buttons, and seamless auto-correct compatible inputs.',
    },
  ];

  return (
    <section id="seo-game-guide" className="panel panel--shadow faq">
      <div className="faq__head">
        <div className="faq__badge">
          <BookOpen />
        </div>
        <div>
          <h2 className="faq__title">Game Guide & Frequently Asked Questions</h2>
          <p className="faq__subtitle">Everything you need to know about Letters Daily (NPAT)</p>
        </div>
      </div>

      <div className="faq__intro">
        <p>
          Welcome to <strong>Letters Daily</strong>, the definitive digital edition of the classic{' '}
          <strong>Name, Place, Animal, Thing</strong> word puzzle. Designed for word enthusiasts, trivia fans, and fast-thinkers of all ages, Letters Daily combines rapid vocabulary challenges with AI-powered validation, daily streak rewards, and competitive bonus twists.
        </p>
      </div>

      <div className="faq__list">
        <h3 className="faq__list-title">
          <HelpCircle />
          Common Questions
        </h3>

        {faqs.map((faq, idx) => {
          const isOpen = openFaq === idx;
          return (
            <div key={idx} className="faq__item">
              <button
                type="button"
                onClick={() => toggleFaq(idx)}
                aria-expanded={isOpen}
                className="faq__question"
              >
                <span className="faq__question-text">
                  <span className="faq__number">0{idx + 1}.</span>
                  {faq.q}
                </span>
                {isOpen ? (
                  <ChevronUp className="faq__chevron faq__chevron--open" />
                ) : (
                  <ChevronDown className="faq__chevron" />
                )}
              </button>
              {isOpen && <div className="faq__answer">{faq.a}</div>}
            </div>
          );
        })}
      </div>

      <div className="faq__tip">
        <Sparkles />
        <div className="faq__tip-body">
          <p className="faq__tip-title">Mobile Pro-Tip</p>
          <p className="faq__tip-text">
            Add Letters Daily to your phone home screen for quick 1-minute daily puzzle rounds right when you wake up!
          </p>
        </div>
      </div>
    </section>
  );
};
