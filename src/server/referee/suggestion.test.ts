import { describe, expect, it } from 'vitest';
import { BonusChallenge, CategoryKey } from '../../shared/contract';
import { bonusRuleApplies, enforceSuggestions, suggestionStands } from './suggestion';
import { CategoryJudgement, JudgeVerdict } from './types';

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

describe('suggestions for a valid answer that missed the bonus', () => {

  function accepted(suggestion?: string, bonusMatched = false): CategoryJudgement {
    return { valid: true, bonusMatched, feedback: 'Nice.', suggestion };
  }

  function verdictOf(categories: Partial<Record<CategoryKey, CategoryJudgement>>): JudgeVerdict {
    return {
      judgedBy: 'azure',
      categories: {
        name: accepted(),
        place: accepted(),
        animal: accepted(),
        thing: accepted(),
        ...categories,
      },
    };
  }

  it('keeps a bonus-earning suggestion on an answer that was right but missed it', () => {
    const settled = enforceSuggestions(
      verdictOf({ name: accepted('Hhoney') }),
      'H',
      doubleH,
      { ...NO_ANSWERS, name: 'Harry' }
    );

    expect(settled.categories.name.suggestion).toBe('Hhoney');
  });

  it('drops one that would not have earned the bonus either', () => {

    const settled = enforceSuggestions(
      verdictOf({ name: accepted('Harold') }),
      'H',
      doubleH,
      { ...NO_ANSWERS, name: 'Harry' }
    );

    expect(settled.categories.name.suggestion).toBeUndefined();
  });

  it('holds a bonus suggestion to a "some" rule, unlike a mere correction', () => {

    expect(suggestionStands('Harry', 'name', 'H', someOnly, true)).toBe(false);
    expect(suggestionStands('Hhoney', 'name', 'H', someOnly, true)).toBe(true);
  });

  it('says nothing when the answer already earned the bonus', () => {
    const settled = enforceSuggestions(
      verdictOf({ name: accepted('Hhoney', true) }),
      'H',
      doubleH,
      { ...NO_ANSWERS, name: 'Hhappy' }
    );

    expect(settled.categories.name.suggestion).toBeUndefined();
  });

  it('says nothing to a category the bonus rule could never apply to', () => {

    const settled = enforceSuggestions(
      verdictOf({ name: accepted('Hhoney'), thing: accepted('Hhammer') }),
      'H',
      thingOnly,
      NO_ANSWERS
    );

    expect(settled.categories.name.suggestion).toBeUndefined();
    expect(settled.categories.thing.suggestion).toBe('Hhammer');
  });

  it('still refuses a bonus suggestion that breaks the letter rule', () => {
    const settled = enforceSuggestions(
      verdictOf({ name: accepted('Ashhold') }),
      'H',
      doubleH,
      NO_ANSWERS
    );

    expect(settled.categories.name.suggestion).toBeUndefined();
  });

  it('advises every applicable category independently', () => {

    const settled = enforceSuggestions(
      verdictOf({
        name: accepted('Hhoney'),
        place: accepted('Hhaven'),
        animal: accepted('Hhippo'),
        thing: accepted('Hhammer'),
      }),
      'H',
      doubleH,
      NO_ANSWERS
    );

    expect(settled.categories.name.suggestion).toBe('Hhoney');
    expect(settled.categories.place.suggestion).toBe('Hhaven');
    expect(settled.categories.animal.suggestion).toBe('Hhippo');
    expect(settled.categories.thing.suggestion).toBe('Hhammer');
  });
});

describe('bonusRuleApplies', () => {
  it('is true for every category under an "all" or "some" rule', () => {
    for (const key of ['name', 'place', 'animal', 'thing'] as CategoryKey[]) {
      expect(bonusRuleApplies(doubleH, key)).toBe(true);
      expect(bonusRuleApplies(someOnly, key)).toBe(true);
    }
  });

  it('is true only for the category a scoped rule names', () => {
    expect(bonusRuleApplies(thingOnly, 'thing')).toBe(true);
    expect(bonusRuleApplies(thingOnly, 'name')).toBe(false);
  });

  it('applies a ruleless challenge everywhere, since the judge decides it', () => {
    expect(bonusRuleApplies({ ...doubleH, rule: undefined }, 'name')).toBe(true);
  });

  it('is false when there is no challenge at all', () => {
    expect(bonusRuleApplies(undefined, 'name')).toBe(false);
  });
});
