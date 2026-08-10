import { describe, expect, it } from 'vitest';
import { BonusChallenge, CategoryKey } from '../../shared/contract';
import { enforceSuggestions, suggestionStands } from './suggestion';
import { CategoryJudgement, JudgeVerdict } from './types';

/** The challenge from the round that exposed this: letter H, "hh" required. */
const doubleH: BonusChallenge = {
  id: 'double_h',
  title: 'Double H Power',
  description: "Every answer must contain the double letter 'hh' consecutively.",
  icon: 'Sparkles',
  ruleHint: "Answers need 'hh'.",
  rule: { scope: 'all', checkKind: 'doubleLetter', checkValue: 'h' },
};

const thingOnly: BonusChallenge = {
  ...doubleH,
  rule: { scope: 'thing', checkKind: 'doubleLetter', checkValue: 'h' },
};

const unknowable: BonusChallenge = {
  ...doubleH,
  rule: { scope: 'all', checkKind: 'none', checkValue: '' },
};

/** Only 2 of 4 answers need to match, so no single word can be condemned by it. */
const someOnly: BonusChallenge = {
  ...doubleH,
  rule: { scope: 'some', checkKind: 'doubleLetter', checkValue: 'h' },
};

function rejected(suggestion?: string): CategoryJudgement {
  return { valid: false, bonusMatched: false, feedback: 'Nope.', suggestion };
}

function verdictWith(suggestions: Partial<Record<CategoryKey, string>>): JudgeVerdict {
  return {
    judgedBy: 'azure',
    categories: {
      name: rejected(suggestions.name),
      place: rejected(suggestions.place),
      animal: rejected(suggestions.animal),
      thing: rejected(suggestions.thing),
    },
  };
}

describe('suggestionStands', () => {
  it('rejects the suggestion that exposed this — wrong letter and no double h', () => {
    // Observed live: a rejected Name under letter H was offered "Rhythm".
    expect(suggestionStands('Rhythm', 'name', 'H', doubleH)).toBe(false);
  });

  it('accepts one that satisfies both the letter and the rule', () => {
    expect(suggestionStands('Hhoney', 'name', 'H', doubleH)).toBe(true);
  });

  it('rejects one that starts right but breaks the rule', () => {
    expect(suggestionStands('Harry', 'name', 'H', doubleH)).toBe(false);
  });

  it('rejects one that satisfies the rule but starts with another letter', () => {
    expect(suggestionStands('Ashhold', 'name', 'H', doubleH)).toBe(false);
  });

  it('does not hold a suggestion to a "some" rule it was never required to meet', () => {
    // scope "some" asks only that SCORING.bonusChallengeThreshold answers match,
    // so a suggestion failing the check may be one of the two that never had to.
    // Holding it to an "all"-strength check silently dropped good suggestions.
    expect(suggestionStands('Harry', 'name', 'H', someOnly)).toBe(true);
  });

  it('still holds a suggestion to a rule every answer must satisfy', () => {
    expect(suggestionStands('Harry', 'name', 'H', doubleH)).toBe(false);
  });

  it('rejects a blank or missing suggestion', () => {
    expect(suggestionStands('   ', 'name', 'H', doubleH)).toBe(false);
    expect(suggestionStands(undefined, 'name', 'H', doubleH)).toBe(false);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(suggestionStands('  hhoney ', 'name', 'h', doubleH)).toBe(true);
  });

  it('asks nothing of a category the rule does not name', () => {
    // "The Thing must contain hh" says nothing about a Name.
    expect(suggestionStands('Harry', 'name', 'H', thingOnly)).toBe(true);
    expect(suggestionStands('Hammer', 'thing', 'H', thingOnly)).toBe(false);
  });

  it('keeps a suggestion when only a judge could settle the rule', () => {
    expect(suggestionStands('Harry', 'name', 'H', unknowable)).toBe(true);
  });

  it('keeps a suggestion when the challenge carries no rule at all', () => {
    const ruleless = { ...doubleH, rule: undefined };

    expect(suggestionStands('Harry', 'name', 'H', ruleless)).toBe(true);
    expect(suggestionStands('Harry', 'name', 'H', undefined)).toBe(true);
  });
});

const NO_ANSWERS = { name: '', place: '', animal: '', thing: '' };

describe('enforceSuggestions', () => {
  it('drops a suggestion the game cannot stand behind', () => {
    const settled = enforceSuggestions(verdictWith({ name: 'Rhythm' }), 'H', doubleH, NO_ANSWERS);

    expect(settled.categories.name.suggestion).toBeUndefined();
  });

  it('leaves the rest of the ruling alone when it drops one', () => {
    const settled = enforceSuggestions(verdictWith({ name: 'Rhythm' }), 'H', doubleH, NO_ANSWERS);

    expect(settled.categories.name.feedback).toBe('Nope.');
    expect(settled.categories.name.valid).toBe(false);
  });

  it('keeps a suggestion that would itself have scored', () => {
    const settled = enforceSuggestions(
      verdictWith({ animal: 'Hhippo' }),
      'H',
      doubleH,
      NO_ANSWERS
    );

    expect(settled.categories.animal.suggestion).toBe('Hhippo');
  });

  it('drops a suggestion that merely repeats the answer just rejected', () => {
    const settled = enforceSuggestions(verdictWith({ name: 'Hhoney' }), 'H', doubleH, {
      ...NO_ANSWERS,
      name: ' hhoney ',
    });

    expect(settled.categories.name.suggestion).toBeUndefined();
  });

  it('returns the verdict untouched when every suggestion stands', () => {
    const verdict = verdictWith({ name: 'Hhoney' });

    expect(enforceSuggestions(verdict, 'H', doubleH, NO_ANSWERS)).toBe(verdict);
  });

  it('leaves a verdict with no suggestions untouched', () => {
    const verdict = verdictWith({});

    expect(enforceSuggestions(verdict, 'H', doubleH, NO_ANSWERS)).toBe(verdict);
  });
});
