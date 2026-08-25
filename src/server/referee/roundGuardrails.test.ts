import { describe, expect, it } from 'vitest';
import { BonusChallenge, CategoryKey, UserAnswers } from '../../shared/contract';
import {
  bonusRuleApplies,
  enforceBonusRule,
  enforceSuggestions,
  enforceTargetLetter,
  endingsOf,
  satisfiesCheck,
  startsWithTargetLetter,
  suggestionStands,
  targetLetterOf,
  withOnlyMatchingLetters,
} from './roundGuardrails';
import { JudgeVerdict } from './types';

const bonus: BonusChallenge = {
  id: 'double_letter',
  title: 'Double Trouble',
  description: 'At least 2 answers must contain a double letter.',
  icon: 'Sparkles',
  ruleHint: 'Words should have a double letter.',
  rule: { scope: 'some', checkKind: 'doubleLetter', checkValue: 'l' },
};

function verdict(
  overrides: Partial<Record<CategoryKey, { valid: boolean; bonusMatched: boolean; feedback: string; suggestion?: string }>> = {}
): JudgeVerdict {
  const categories = {
    name: { valid: true, bonusMatched: false, feedback: 'Good' },
    place: { valid: true, bonusMatched: false, feedback: 'Good' },
    animal: { valid: true, bonusMatched: false, feedback: 'Good' },
    thing: { valid: true, bonusMatched: false, feedback: 'Good' },
    ...overrides,
  } as Record<CategoryKey, any>;

  return {
    judgedBy: 'azure',
    categories,
    overallFeedback: 'Nice',
    bonusChallengeMet: false,
  };
}

function answers(over: Partial<UserAnswers> = {}): UserAnswers {
  return {
    name: 'Rally',
    place: 'Rome',
    animal: 'Rabbit',
    thing: 'Rug',
    ...over,
  };
}

describe('roundGuardrails', () => {
  it('parses ending variants and strips quote noise', () => {
    expect(endingsOf('ing, ly or "ed"')).toEqual(['ing', 'ly', 'ed']);
    expect(endingsOf('the letters ing or ly')).toEqual(['ing', 'ly']);
  });

  it('checks mechanical bonus rules against the raw word', () => {
    expect(satisfiesCheck({ scope: 'some', checkKind: 'minLength', checkValue: '5' }, 'Rally')).toBe(true);
    expect(satisfiesCheck({ scope: 'some', checkKind: 'doubleLetter', checkValue: 'l' }, 'Rally')).toBe(true);
    expect(satisfiesCheck({ scope: 'some', checkKind: 'doubleLetter', checkValue: 'l' }, 'Ruby')).toBe(false);
    expect(satisfiesCheck({ scope: 'some', checkKind: 'endsWith', checkValue: 'ing or ly' }, 'Rug')).toBe(false);
    expect(satisfiesCheck({ scope: 'some', checkKind: 'endsWithVowel', checkValue: '' }, 'Rug')).toBe(false);
  });

  it('enforces a bonus rule across the relevant categories', () => {
    const settled = enforceBonusRule(
      verdict(),
      {
        name: 'Rally',
        place: 'Roll',
        animal: 'Rabbit',
        thing: 'Rug',
      },
      bonus
    );

    expect(settled.categories.name.bonusMatched).toBe(true);
    expect(settled.categories.place.bonusMatched).toBe(true);
    expect(settled.categories.thing.bonusMatched).toBe(false);
    expect(settled.bonusChallengeMet).toBe(true);
  });

  it('decides when a bonus rule applies to a category', () => {
    expect(bonusRuleApplies(bonus, 'name')).toBe(true);
    expect(bonusRuleApplies(bonus, 'thing')).toBe(true);
    expect(bonusRuleApplies({ ...bonus, rule: { ...bonus.rule!, scope: 'thing' } }, 'name')).toBe(false);
  });

  it('drops suggestions that cannot stand behind the rule', () => {
    const kept = enforceSuggestions(
      verdict({
        thing: { valid: true, bonusMatched: false, feedback: 'Good', suggestion: 'Rally' },
      }),
      'R',
      bonus,
      answers({ thing: 'Rug' })
    );

    expect(kept.categories.thing.suggestion).toBe('Rally');

    const dropped = enforceSuggestions(
      verdict({
        thing: { valid: true, bonusMatched: false, feedback: 'Good', suggestion: 'Rag' },
      }),
      'R',
      { ...bonus, rule: { scope: 'some', checkKind: 'minLength', checkValue: '5' } },
      answers({ thing: 'Rug' })
    );

    expect(dropped.categories.thing.suggestion).toBeUndefined();
  });

  it('checks the target letter on both the prompt and the final verdict', () => {
    expect(targetLetterOf('ruby')).toBe('R');
    expect(startsWithTargetLetter('Ruby', 'r')).toBe(true);
    expect(startsWithTargetLetter('Mug', 'r')).toBe(false);

    const filtered = withOnlyMatchingLetters({
      letter: 'R',
      answers: { name: 'Ruby', place: 'Rome', animal: 'Tiger', thing: 'Rug' },
      bonusChallenge: bonus,
    });

    expect(filtered.answers.animal).toBe('');
    expect(filtered.answers.name).toBe('Ruby');
  });

  it('zeroes out illegal words after the model has answered but keeps valid suggestions', () => {
    const verdictWithWrongLetter = enforceTargetLetter(
      verdict({
        name: { valid: true, bonusMatched: false, feedback: 'Good', suggestion: 'Rally' },
        place: { valid: false, bonusMatched: false, feedback: 'Wrong letter' },
      }),
      'R',
      answers({ place: 'Paris', animal: 'Tiger' })
    );

    expect(verdictWithWrongLetter.categories.place.valid).toBe(false);
    expect(verdictWithWrongLetter.categories.place.feedback).toBe('Must start with the letter "R".');
    expect(verdictWithWrongLetter.categories.name.suggestion).toBe('Rally');
  });

  it('rejects suggestions that do not stand behind the rule or the letter', () => {
    expect(suggestionStands('Rally', 'name', 'R', bonus)).toBe(true);
    expect(suggestionStands('Mug', 'name', 'R', bonus)).toBe(false);
    expect(
      suggestionStands('Rug', 'name', 'R', {
        ...bonus,
        rule: { scope: 'thing', checkKind: 'minLength', checkValue: '5' },
      })
    ).toBe(true);
  });
});
