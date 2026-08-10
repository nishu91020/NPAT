import { describe, expect, it } from 'vitest';
import { BonusChallenge, CategoryKey } from '../../shared/contract';
import { enforceBonusRule, satisfiesCheck } from './bonusRule';
import { bonusMetFor } from './scoring';
import { CategoryJudgement, JudgeVerdict } from './types';

function verdict(
  entries: Partial<Record<CategoryKey, Partial<CategoryJudgement>>>,
  bonusChallengeMet?: boolean
): JudgeVerdict {
  const base: CategoryJudgement = { valid: true, bonusMatched: false, feedback: '' };
  return {
    judgedBy: 'azure',
    categories: {
      name: { ...base, ...entries.name },
      place: { ...base, ...entries.place },
      animal: { ...base, ...entries.animal },
      thing: { ...base, ...entries.thing },
    },
    bonusChallengeMet,
  };
}

function challenge(rule: BonusChallenge['rule']): BonusChallenge {
  return {
    id: 'test',
    title: 'Test',
    description: 'A test rule.',
    icon: 'Sparkles',
    ruleHint: 'test',
    rule,
  };
}

describe('satisfiesCheck', () => {
  it('leaves a rule needing world knowledge to the judge', () => {
    expect(satisfiesCheck({ scope: 'some', checkKind: 'none', checkValue: '' }, 'Spain')).toBeNull();
  });

  it('decides adjacent vowels the same way every time', () => {
    const rule = { scope: 'all', checkKind: 'adjacentVowels', checkValue: '' } as const;
    // The exact words the model disagreed with itself about across identical runs.
    expect(satisfiesCheck(rule, 'Sean')).toBe(true);
    expect(satisfiesCheck(rule, 'Seattle')).toBe(true);
    expect(satisfiesCheck(rule, 'Snail')).toBe(true);
    expect(satisfiesCheck(rule, 'Sauce')).toBe(true);
    expect(satisfiesCheck(rule, 'Snake')).toBe(false);
    expect(satisfiesCheck(rule, 'Sam')).toBe(false);
  });

  it('counts vowels anywhere for minVowels, which is a different rule', () => {
    const rule = { scope: 'all', checkKind: 'minVowels', checkValue: '2' } as const;
    expect(satisfiesCheck(rule, 'Snake')).toBe(true);
    expect(satisfiesCheck(rule, 'Sam')).toBe(false);
  });

  it('decides minLength', () => {
    const rule = { scope: 'all', checkKind: 'minLength', checkValue: '5' } as const;
    expect(satisfiesCheck(rule, 'Spoon')).toBe(true);
    expect(satisfiesCheck(rule, 'Sofa')).toBe(false);
  });

  it('decides doubleLetter', () => {
    const rule = { scope: 'all', checkKind: 'doubleLetter', checkValue: '' } as const;
    expect(satisfiesCheck(rule, 'Spoon')).toBe(true);
    expect(satisfiesCheck(rule, 'Snail')).toBe(false);
  });

  it('honours a named double letter, so "must contain ss" is not met by "Sunny"', () => {
    const rule = { scope: 'all', checkKind: 'doubleLetter', checkValue: 'ss' } as const;
    expect(satisfiesCheck(rule, 'Grass')).toBe(true);
    expect(satisfiesCheck(rule, 'Sunny')).toBe(false);
  });

  it('reads a single named letter as that letter doubled', () => {
    const rule = { scope: 'all', checkKind: 'doubleLetter', checkValue: 's' } as const;
    expect(satisfiesCheck(rule, 'Grass')).toBe(true);
    expect(satisfiesCheck(rule, 'Spain')).toBe(false);
  });

  it('decides endsWith, ignoring case', () => {
    const rule = { scope: 'all', checkKind: 'endsWith', checkValue: 'E' } as const;
    expect(satisfiesCheck(rule, 'Snake')).toBe(true);
    expect(satisfiesCheck(rule, 'Spoon')).toBe(false);
  });

  it('credits a word ending in a vowel', () => {
    const rule = { scope: 'all', checkKind: 'endsWithVowel', checkValue: '' } as const;
    expect(satisfiesCheck(rule, 'Vase')).toBe(true);
    expect(satisfiesCheck(rule, 'Sofa')).toBe(true);
    expect(satisfiesCheck(rule, 'Spoon')).toBe(false);
  });

  describe('an ending written as prose is still read as the rule it states', () => {
    // Observed live: "every answer must end in a vowel" reached the referee as
    // an endsWith rule, and no word ends with the string "a, e, i, o, u", so
    // "Vase" scored nothing under a rule it plainly satisfied.
    it.each(['a vowel', 'vowel', 'a, e, i, o, u', 'a/e/i/o/u', 'a or e or i or o or u'])(
      'credits "Vase" for an endsWith value of %j',
      (checkValue) => {
        expect(satisfiesCheck({ scope: 'all', checkKind: 'endsWith', checkValue }, 'Vase')).toBe(
          true
        );
      }
    );

    it('still refuses a word that ends in a consonant', () => {
      const rule = { scope: 'all', checkKind: 'endsWith', checkValue: 'a, e, i, o, u' } as const;
      expect(satisfiesCheck(rule, 'Spoon')).toBe(false);
    });

    it('reads a list of endings as alternatives rather than one literal string', () => {
      const rule = { scope: 'all', checkKind: 'endsWith', checkValue: 'ly or ing' } as const;
      expect(satisfiesCheck(rule, 'Sailing')).toBe(true);
      expect(satisfiesCheck(rule, 'Sadly')).toBe(true);
      expect(satisfiesCheck(rule, 'Spoon')).toBe(false);
    });

    it('ignores the wrapping a named ending arrives in', () => {
      const rule = { scope: 'all', checkKind: 'endsWith', checkValue: 'the letter "e"' } as const;
      expect(satisfiesCheck(rule, 'Snake')).toBe(true);
      expect(satisfiesCheck(rule, 'Spoon')).toBe(false);
    });
  });

  it('never credits an empty answer', () => {
    const rule = { scope: 'all', checkKind: 'minVowels', checkValue: '0' } as const;
    expect(satisfiesCheck(rule, '')).toBe(false);
    expect(satisfiesCheck(rule, '   ')).toBe(false);
  });
});

describe('bonusMetFor', () => {
  it('requires every answer when the rule says every answer', () => {
    expect(bonusMetFor('all', ['name', 'place', 'animal', 'thing'])).toBe(true);
    expect(bonusMetFor('all', ['name', 'place', 'animal'])).toBe(false);
  });

  it('requires two answers when the rule is about a shared theme', () => {
    expect(bonusMetFor('some', ['name', 'place'])).toBe(true);
    expect(bonusMetFor('some', ['name'])).toBe(false);
  });

  it('requires only the named category when the rule names one', () => {
    // The bug: "the Thing must be edible" was counted against a threshold of
    // two, so it could never be met however good the answer was.
    expect(bonusMetFor('thing', ['thing'])).toBe(true);
    expect(bonusMetFor('name', ['name'])).toBe(true);
    expect(bonusMetFor('thing', ['name', 'place'])).toBe(false);
  });
});

describe('enforceBonusRule', () => {
  it('overrules the judge on a rule the game can decide itself', () => {
    const before = verdict({
      name: { bonusMatched: true },
      place: { bonusMatched: true },
      animal: { bonusMatched: false },
      thing: { bonusMatched: false },
    });

    const after = enforceBonusRule(
      before,
      { name: 'Sean', place: 'Seattle', animal: 'Snail', thing: 'Sauce' },
      challenge({ scope: 'all', checkKind: 'adjacentVowels', checkValue: '' })
    );

    // All four have two vowels together, whatever the judge claimed.
    expect(after.categories.animal.bonusMatched).toBe(true);
    expect(after.categories.thing.bonusMatched).toBe(true);
    expect(after.bonusChallengeMet).toBe(true);
  });

  it('withdraws a bonus the judge awarded against the rule', () => {
    const before = verdict({ animal: { bonusMatched: true } });

    const after = enforceBonusRule(
      before,
      { name: 'Sam', place: 'Span', animal: 'Snake', thing: 'Sock' },
      challenge({ scope: 'all', checkKind: 'adjacentVowels', checkValue: '' })
    );

    expect(after.categories.animal.bonusMatched).toBe(false);
  });

  it('gives the same answer every time, which is the whole point', () => {
    const answers = { name: 'Sean', place: 'Seattle', animal: 'Snail', thing: 'Sauce' };
    const rule = challenge({ scope: 'all', checkKind: 'adjacentVowels', checkValue: '' });

    const results = Array.from({ length: 20 }, () =>
      JSON.stringify(enforceBonusRule(verdict({}), answers, rule).categories)
    );

    expect(new Set(results).size).toBe(1);
  });

  it('lets a single-category challenge be met by that category alone', () => {
    const before = verdict({ thing: { bonusMatched: true } }, false);

    const after = enforceBonusRule(
      before,
      { name: 'Sam', place: 'Spain', animal: 'Snake', thing: 'Soup' },
      challenge({ scope: 'thing', checkKind: 'none', checkValue: '' })
    );

    expect(after.bonusChallengeMet).toBe(true);
  });

  it('leaves a world-knowledge rule to the judge, only fixing the scope', () => {
    const before = verdict({ name: { bonusMatched: true } }, false);

    const after = enforceBonusRule(
      before,
      { name: 'Einstein', place: 'Egypt', animal: 'Eagle', thing: 'Easel' },
      challenge({ scope: 'name', checkKind: 'none', checkValue: '' })
    );

    expect(after.categories.name.bonusMatched).toBe(true);
    expect(after.categories.place.bonusMatched).toBe(false);
    expect(after.bonusChallengeMet).toBe(true);
  });

  it('never credits a bonus to an answer the judge ruled invalid', () => {
    const before = verdict({ animal: { valid: false, bonusMatched: false } });

    const after = enforceBonusRule(
      before,
      { name: 'Sean', place: 'Seattle', animal: 'Tiger', thing: 'Sauce' },
      challenge({ scope: 'all', checkKind: 'minVowels', checkValue: '2' })
    );

    expect(after.categories.animal.bonusMatched).toBe(false);
  });

  it('changes nothing when the challenge carries no rule', () => {
    const before = verdict({ name: { bonusMatched: true }, place: { bonusMatched: true } }, true);

    const after = enforceBonusRule(
      before,
      { name: 'Sean', place: 'Seattle', animal: 'Snail', thing: 'Sauce' },
      challenge(undefined)
    );

    expect(after).toEqual(before);
  });
});

/**
 * A rule that names one category says nothing about the other three, so a
 * mechanical check must not be applied to them. Reachable in production: four
 * of the generator rule families constrain a single category, and nothing stops
 * one being paired with a mechanical check.
 */
describe('enforceBonusRule and scope', () => {
  it('does not award a single-category rule to the categories it never mentions', () => {
    const after = enforceBonusRule(
      verdict({}),
      { name: 'Anna', place: 'Atlanta', animal: 'Anaconda', thing: 'Apple' },
      challenge({ scope: 'place', checkKind: 'endsWith', checkValue: 'a' })
    );

    expect(after.categories.place.bonusMatched).toBe(true);
    expect(after.categories.name.bonusMatched).toBe(false);
    expect(after.categories.animal.bonusMatched).toBe(false);
    expect(after.bonusChallengeMet).toBe(true);
  });

  it('withdraws a bonus the judge gave a category outside the rule', () => {
    const after = enforceBonusRule(
      verdict({ name: { bonusMatched: true }, thing: { bonusMatched: true } }),
      { name: 'Anna', place: 'Atlanta', animal: 'Anaconda', thing: 'Apple' },
      challenge({ scope: 'place', checkKind: 'none', checkValue: '' })
    );

    expect(after.categories.name.bonusMatched).toBe(false);
    expect(after.categories.thing.bonusMatched).toBe(false);
  });

  it('still applies a whole-round rule to every category', () => {
    const after = enforceBonusRule(
      verdict({}),
      { name: 'Sean', place: 'Seattle', animal: 'Snail', thing: 'Sauce' },
      challenge({ scope: 'all', checkKind: 'adjacentVowels', checkValue: '' })
    );

    for (const key of ['name', 'place', 'animal', 'thing'] as const) {
      expect(after.categories[key].bonusMatched).toBe(true);
    }
  });
});

describe('satisfiesCheck refuses to decide without a usable threshold', () => {
  it.each(['', '  ', '0', '-1', 'five'])('hands %j back to the judge', (value) => {
    expect(satisfiesCheck({ scope: 'all', checkKind: 'minLength', checkValue: value }, 'Sam')).toBeNull();
    expect(satisfiesCheck({ scope: 'all', checkKind: 'minVowels', checkValue: value }, 'Shh')).toBeNull();
  });
});

describe('unwinnable rules are handed back rather than enforced', () => {
  it.each(['', '   '])('treats a blank endsWith value (%j) as undecidable', (value) => {
    expect(satisfiesCheck({ scope: 'all', checkKind: 'endsWith', checkValue: value }, 'Spa')).toBeNull();
  });

  it('refuses a threshold no word could reach', () => {
    expect(
      satisfiesCheck({ scope: 'all', checkKind: 'minLength', checkValue: 'Infinity' }, 'Sam')
    ).toBeNull();
  });
});
