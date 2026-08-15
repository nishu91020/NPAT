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
    <section id="seo-game-guide" className="w-full bg-white border-2 border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
      <div className="flex items-center gap-3 pb-4 border-b-2 border-slate-100">
        <div className="w-9 h-9 bg-slate-900 text-white flex items-center justify-center font-black shrink-0">
          <BookOpen className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-lg sm:text-xl font-black text-slate-900 uppercase tracking-tight">
            Game Guide & Frequently Asked Questions
          </h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Everything you need to know about Letters Daily (NPAT)
          </p>
        </div>
      </div>

      {/* SEO Intro Content */}
      <div className="text-xs font-medium text-slate-600 space-y-3 leading-relaxed">
        <p>
          Welcome to <strong className="text-slate-900 font-extrabold">Letters Daily</strong>, the definitive digital edition of the classic <strong className="text-slate-900 font-extrabold">Name, Place, Animal, Thing</strong> word puzzle. Designed for word enthusiasts, trivia fans, and fast-thinkers of all ages, Letters Daily combines rapid vocabulary challenges with AI-powered validation, daily streak rewards, and competitive bonus twists.
        </p>
      </div>

      {/* FAQ Accordion */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-3">
          <HelpCircle className="w-4 h-4 text-indigo-600" />
          Common Questions
        </h3>

        {faqs.map((faq, idx) => {
          const isOpen = openFaq === idx;
          return (
            <div key={idx} className="border-2 border-slate-200 transition-colors">
              <button
                type="button"
                onClick={() => toggleFaq(idx)}
                aria-expanded={isOpen}
                className="w-full min-h-[48px] px-4 py-3 flex items-center justify-between text-left font-black text-xs uppercase tracking-wider text-slate-800 hover:bg-slate-50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <span className="text-indigo-600 font-mono">0{idx + 1}.</span>
                  {faq.q}
                </span>
                {isOpen ? (
                  <ChevronUp className="w-4 h-4 text-indigo-600 shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                )}
              </button>
              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-slate-100 text-xs font-semibold text-slate-600 leading-relaxed bg-slate-50/50">
                  {faq.a}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile Tips Box */}
      <div className="p-4 bg-indigo-50 border-l-4 border-indigo-600 border-y border-r border-indigo-100 flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
        <div className="text-xs">
          <p className="font-black text-indigo-900 uppercase tracking-wide">Mobile Pro-Tip</p>
          <p className="text-indigo-800 font-medium mt-0.5">
            Add Letters Daily to your phone home screen for quick 1-minute daily puzzle rounds right when you wake up!
          </p>
        </div>
      </div>
    </section>
  );
};
