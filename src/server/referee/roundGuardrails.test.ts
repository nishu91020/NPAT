import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { BonusChallenge, CategoryKey, UserAnswers } from '../../shared/contract';
import { createAzureJudge } from './azureJudge';
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
import { CategoryJudgement, JudgeVerdict } from './types';

const bonus: BonusChallenge = {
  id: 'double_letter',
  title: 'Double Trouble',
  description: 'At least 2 answers must contain a double letter.',
  icon: 'Sparkles',
  ruleHint: 'Words should have a double letter.',
  rule: { scope: 'some', checkKind: 'doubleLetter', checkValue: 'l' },
};

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

const bonusTarget: BonusChallenge = {
  id: 'india_focus',
  title: 'India Connection',
  description: 'At least 2 answers must have a connection to India or South Asia.',
  icon: 'Flag',
  ruleHint: 'Indian names, places, wildlife or cultural items.',
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

function overGenerousVerdict(): JudgeVerdict {
  const pass = (feedback: string) => ({ valid: true, bonusMatched: true, feedback });

  return {
    judgedBy: 'azure',
    categories: {
      name: pass('Shivaji, legendary Indian warrior king.'),
      place: pass('Srinagar, beautiful city in Kashmir, India.'),
      animal: pass("Tiger, India's national animal."),
      thing: { valid: false, bonusMatched: false, feedback: 'Zzzz is not a thing.' },
    },
    overallFeedback: 'Strong India links!',
    bonusChallengeMet: true,
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

  it('drops a suggestion the game cannot stand behind', () => {
    const settled = enforceSuggestions(verdictWith({ name: 'Rhythm' }), 'H', doubleH, {
      name: '',
      place: '',
      animal: '',
      thing: '',
    });

    expect(settled.categories.name.suggestion).toBeUndefined();
  });

  it('leaves the rest of the ruling alone when it drops one suggestion', () => {
    const settled = enforceSuggestions(verdictWith({ name: 'Rhythm' }), 'H', doubleH, {
      name: '',
      place: '',
      animal: '',
      thing: '',
    });

    expect(settled.categories.name.feedback).toBe('Nope.');
    expect(settled.categories.name.valid).toBe(false);
  });

  it('keeps a suggestion that would itself have scored', () => {
    const settled = enforceSuggestions(verdictWith({ animal: 'Hhippo' }), 'H', doubleH, {
      name: '',
      place: '',
      animal: '',
      thing: '',
    });

    expect(settled.categories.animal.suggestion).toBe('Hhippo');
  });

  it('drops a suggestion that merely repeats the answer just rejected', () => {
    const settled = enforceSuggestions(verdictWith({ name: 'Hhoney' }), 'H', doubleH, {
      ...{ name: '', place: '', animal: '', thing: '' },
      name: ' hhoney ',
    });

    expect(settled.categories.name.suggestion).toBeUndefined();
  });

  it('returns the verdict untouched when every suggestion stands', () => {
    const verdictValue = verdictWith({ name: 'Hhoney' });
    expect(enforceSuggestions(verdictValue, 'H', doubleH, { name: '', place: '', animal: '', thing: '' })).toBe(verdictValue);
  });

  it('leaves a verdict with no suggestions untouched', () => {
    const verdictValue = verdictWith({});
    expect(enforceSuggestions(verdictValue, 'H', doubleH, { name: '', place: '', animal: '', thing: '' })).toBe(verdictValue);
  });

  it('keeps a bonus-earning suggestion on an answer that was right but missed it', () => {
    function accepted(suggestion?: string, bonusMatched = false): CategoryJudgement {
      return { valid: true, bonusMatched, feedback: 'Nice.', suggestion };
    }

    const verdictValue = {
      judgedBy: 'azure',
      categories: {
        name: accepted('Hhoney'),
        place: accepted(),
        animal: accepted(),
        thing: accepted(),
      },
    } as JudgeVerdict;

    const settled = enforceSuggestions(verdictValue, 'H', doubleH, {
      name: 'Harry',
      place: '',
      animal: '',
      thing: '',
    });

    expect(settled.categories.name.suggestion).toBe('Hhoney');
  });

  it('drops one that would not have earned the bonus either', () => {
    function accepted(suggestion?: string, bonusMatched = false): CategoryJudgement {
      return { valid: true, bonusMatched, feedback: 'Nice.', suggestion };
    }

    const verdictValue = {
      judgedBy: 'azure',
      categories: {
        name: accepted('Harold'),
        place: accepted(),
        animal: accepted(),
        thing: accepted(),
      },
    } as JudgeVerdict;

    const settled = enforceSuggestions(verdictValue, 'H', doubleH, {
      name: 'Harry',
      place: '',
      animal: '',
      thing: '',
    });

    expect(settled.categories.name.suggestion).toBeUndefined();
  });

  it('holds a bonus suggestion to a "some" rule, unlike a mere correction', () => {
    expect(suggestionStands('Harry', 'name', 'H', someOnly, true)).toBe(false);
    expect(suggestionStands('Hhoney', 'name', 'H', someOnly, true)).toBe(true);
  });

  it('says nothing when the answer already earned the bonus', () => {
    function accepted(suggestion?: string, bonusMatched = false): CategoryJudgement {
      return { valid: true, bonusMatched, feedback: 'Nice.', suggestion };
    }

    const verdictValue = {
      judgedBy: 'azure',
      categories: {
        name: accepted('Hhoney', true),
        place: accepted(),
        animal: accepted(),
        thing: accepted(),
      },
    } as JudgeVerdict;

    const settled = enforceSuggestions(verdictValue, 'H', doubleH, {
      name: 'Hhappy',
      place: '',
      animal: '',
      thing: '',
    });

    expect(settled.categories.name.suggestion).toBeUndefined();
  });

  it('says nothing to a category the bonus rule could never apply to', () => {
    function accepted(suggestion?: string): CategoryJudgement {
      return { valid: true, bonusMatched: false, feedback: 'Nice.', suggestion };
    }

    const verdictValue = {
      judgedBy: 'azure',
      categories: {
        name: accepted('Hhoney'),
        place: accepted(),
        animal: accepted(),
        thing: accepted('Hhammer'),
      },
    } as JudgeVerdict;

    const settled = enforceSuggestions(verdictValue, 'H', thingOnly, {
      name: '',
      place: '',
      animal: '',
      thing: '',
    });

    expect(settled.categories.name.suggestion).toBeUndefined();
    expect(settled.categories.thing.suggestion).toBe('Hhammer');
  });

  it('still refuses a bonus suggestion that breaks the letter rule', () => {
    function accepted(suggestion?: string): CategoryJudgement {
      return { valid: true, bonusMatched: false, feedback: 'Nice.', suggestion };
    }

    const settled = enforceSuggestions(
      {
        judgedBy: 'azure',
        categories: { name: accepted('Ashhold'), place: accepted(), animal: accepted(), thing: accepted() },
      },
      'H',
      doubleH,
      { name: '', place: '', animal: '', thing: '' }
    );

    expect(settled.categories.name.suggestion).toBeUndefined();
  });

  it('advises every applicable category independently', () => {
    function accepted(suggestion?: string): CategoryJudgement {
      return { valid: true, bonusMatched: false, feedback: 'Nice.', suggestion };
    }

    const settled = enforceSuggestions(
      {
        judgedBy: 'azure',
        categories: {
          name: accepted('Hhoney'),
          place: accepted('Hhaven'),
          animal: accepted('Hhippo'),
          thing: accepted('Hhammer'),
        },
      },
      'H',
      doubleH,
      { name: '', place: '', animal: '', thing: '' }
    );

    expect(settled.categories.name.suggestion).toBe('Hhoney');
    expect(settled.categories.place.suggestion).toBe('Hhaven');
    expect(settled.categories.animal.suggestion).toBe('Hhippo');
    expect(settled.categories.thing.suggestion).toBe('Hhammer');
  });

  it('is true for every category under an "all" or "some" rule', () => {
    for (const key of ['name', 'place', 'animal', 'thing'] as CategoryKey[]) {
      expect(bonusRuleApplies(doubleH, key)).toBe(true);
      expect(bonusRuleApplies(someOnly, key)).toBe(true);
    }
  });

  it('overrules the model when an answer starts with the wrong letter', () => {
    const answersMap = { name: 'Shivaji', place: 'Srinagar', animal: 'Tiger', thing: 'Zzzz' };
    const corrected = enforceTargetLetter(overGenerousVerdict(), 'S', answersMap);

    expect(corrected.categories.animal.valid).toBe(false);
    expect(corrected.categories.animal.bonusMatched).toBe(false);
    expect(corrected.categories.animal.feedback).toBe('Must start with the letter "S".');
  });

  it('leaves correct answers untouched', () => {
    const corrected = enforceTargetLetter(overGenerousVerdict(), 'S', {
      name: 'Shivaji',
      place: 'Srinagar',
      animal: 'Tiger',
      thing: 'Zzzz',
    });

    expect(corrected.categories.name).toEqual({
      valid: true,
      bonusMatched: true,
      feedback: 'Shivaji, legendary Indian warrior king.',
    });
  });

  it('recomputes bonusChallengeMet when a corrected entry changes the tally', () => {
    const verdictValue = overGenerousVerdict();
    verdictValue.categories.place = { valid: true, bonusMatched: false, feedback: 'x' };

    const corrected = enforceTargetLetter(verdictValue, 'S', {
      name: 'Shivaji',
      place: 'Srinagar',
      animal: 'Tiger',
      thing: 'Zzzz',
    });

    expect(corrected.bonusChallengeMet).toBe(false);
  });

  it('is case-insensitive', () => {
    const corrected = enforceTargetLetter(overGenerousVerdict(), 's', {
      name: 'Shivaji',
      place: 'Srinagar',
      animal: 'shark',
      thing: 'Zzzz',
    });

    expect(corrected.categories.animal.valid).toBe(true);
  });

  it('overrules an empty answer the model marked valid', () => {
    const corrected = enforceTargetLetter(overGenerousVerdict(), 'S', {
      name: 'Shivaji',
      place: 'Srinagar',
      animal: '',
      thing: 'Zzzz',
    });

    expect(corrected.categories.animal.valid).toBe(false);
    expect(corrected.categories.animal.feedback).toBe('No answer provided.');
  });

  it('ignores leading whitespace when checking the letter', () => {
    const corrected = enforceTargetLetter(overGenerousVerdict(), 'S', {
      name: 'Shivaji',
      place: 'Srinagar',
      animal: '  Snake',
      thing: 'Zzzz',
    });

    expect(corrected.categories.animal.valid).toBe(true);
  });

  it('returns the verdict unchanged when the model got everything right', () => {
    const verdictValue = overGenerousVerdict();
    const good = { name: 'Sarah', place: 'Spain', animal: 'Shark', thing: 'Spoon' };

    expect(enforceTargetLetter(verdictValue, 'S', good)).toBe(verdictValue);
  });

  it('states the letter rule as the reason a wrong-letter answer failed', () => {
    const corrected = enforceTargetLetter(overGenerousVerdict(), 'S', {
      name: 'Shivaji',
      place: 'Srinagar',
      animal: 'Tiger',
      thing: 'Zzzz',
    });

    expect(corrected.categories.thing.valid).toBe(false);
    expect(corrected.categories.thing.feedback).toBe('Must start with the letter "S".');
  });

  it("keeps the judge's reason for a matching answer it rejected", () => {
    const verdictValue = overGenerousVerdict();
    verdictValue.categories.thing.feedback = 'Sqwrl is not a thing.';

    const corrected = enforceTargetLetter(verdictValue, 'S', {
      name: 'Shivaji',
      place: 'Srinagar',
      animal: 'Tiger',
      thing: 'Sqwrl',
    });

    expect(corrected.categories.thing.valid).toBe(false);
    expect(corrected.categories.thing.feedback).toBe('Sqwrl is not a thing.');
  });

  it('leaves a blank the judge already failed exactly as it is', () => {
    const verdictValue = overGenerousVerdict();
    verdictValue.categories.animal = {
      valid: false,
      bonusMatched: false,
      feedback: 'No answer provided.',
    };

    expect(enforceTargetLetter(verdictValue, 'S', { ...{ name: 'Shivaji', place: 'Srinagar', animal: '', thing: 'Spoon' }, animal: '' })).toBe(verdictValue);
  });

  it('keeps a suggestion that starts with the target letter', () => {
    const verdictValue = overGenerousVerdict();
    verdictValue.categories.animal.suggestion = 'Snake';

    const corrected = enforceTargetLetter(verdictValue, 'S', {
      name: 'Shivaji',
      place: 'Srinagar',
      animal: 'Tiger',
      thing: 'Zzzz',
    });

    expect(corrected.categories.animal.suggestion).toBe('Snake');
  });

  it('drops a suggestion that would itself have been rejected', () => {
    const verdictValue = overGenerousVerdict();
    verdictValue.categories.animal.suggestion = 'Elephant';

    const corrected = enforceTargetLetter(verdictValue, 'S', {
      name: 'Shivaji',
      place: 'Srinagar',
      animal: 'Tiger',
      thing: 'Zzzz',
    });

    expect(corrected.categories.animal.suggestion).toBeUndefined();
  });

  it('ignores case and surrounding whitespace for letter checks', () => {
    expect(startsWithTargetLetter('  lizabeth ', 'L')).toBe(true);
    expect(startsWithTargetLetter('Lizabeth', 'l')).toBe(true);
  });

  it('rejects a blank answer', () => {
    expect(startsWithTargetLetter('   ', 'L')).toBe(false);
    expect(startsWithTargetLetter('', 'L')).toBe(false);
  });

  it('rejects a word starting with another letter', () => {
    expect(startsWithTargetLetter('Tiger', 'S')).toBe(false);
  });

  it('withholds a wrong-letter answer so the judge cannot rule on the letter', () => {
    const request = {
      letter: 'S',
      answers: { name: '  Sarah ', place: 'Tokyo', animal: 'Shark', thing: '' },
      bonusChallenge: bonusTarget,
    };

    expect(withOnlyMatchingLetters(request).answers.place).toBe('');
  });

  it('trims what it passes on, so stray whitespace is never the first character', () => {
    const request = {
      letter: 'S',
      answers: { name: '  Sarah ', place: 'Tokyo', animal: 'Shark', thing: '' },
      bonusChallenge: bonusTarget,
    };

    expect(withOnlyMatchingLetters(request).answers.name).toBe('Sarah');
  });

  it('leaves a matching answer and the rest of the round alone', () => {
    const request = {
      letter: 'S',
      answers: { name: '  Sarah ', place: 'Tokyo', animal: 'Shark', thing: '' },
      bonusChallenge: bonusTarget,
    };
    const filtered = withOnlyMatchingLetters(request);

    expect(filtered.answers.animal).toBe('Shark');
    expect(filtered.letter).toBe('S');
    expect(filtered.bonusChallenge).toBe(bonusTarget);
  });

  it('corrects a wrong-letter answer the model let through', async () => {
    const create = vi.fn(async (_args: any) => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              categories: {
                name: { valid: true, bonusMatched: true, feedback: 'ok' },
                place: { valid: true, bonusMatched: true, feedback: 'ok' },
                animal: { valid: true, bonusMatched: true, feedback: "India's national animal." },
                thing: { valid: true, bonusMatched: true, feedback: 'ok' },
              },
              overallFeedback: 'Nice',
              bonusChallengeMet: true,
            }),
          },
          finish_reason: 'stop',
        },
      ],
    }));
    const client = { chat: { completions: { create } } } as unknown as OpenAI;

    const verdict = await createAzureJudge(client, 'npat-judge').judge({
      letter: 'S',
      answers: { name: 'Sarah', place: 'Spain', animal: 'Tiger', thing: 'Spoon' },
      bonusChallenge: bonusTarget,
    });

    expect(verdict.categories.animal.valid).toBe(false);
    expect(verdict.categories.name.valid).toBe(true);
  });

  it('never shows the model a wrong-letter answer, so it cannot fail one on the letter', async () => {
    const create = vi.fn(async (_args: any) => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              categories: {
                name: { valid: true, bonusMatched: false, feedback: 'ok' },
                place: { valid: true, bonusMatched: false, feedback: 'ok' },
                animal: { valid: false, bonusMatched: false, feedback: 'No answer provided.' },
                thing: { valid: true, bonusMatched: false, feedback: 'ok' },
              },
              overallFeedback: 'Nice',
              bonusChallengeMet: false,
            }),
          },
          finish_reason: 'stop',
        },
      ],
    }));
    const client = { chat: { completions: { create } } } as unknown as OpenAI;

    const verdict = await createAzureJudge(client, 'npat-judge').judge({
      letter: 'L',
      answers: { name: ' Lizabeth', place: 'London', animal: 'Tiger', thing: 'Lamp' },
      bonusChallenge: bonusTarget,
    });

    const prompt = (create.mock.calls[0][0] as any).messages[1].content;
    expect(prompt).toContain('"Lizabeth"');
    expect(prompt).not.toContain('Tiger');
    expect(verdict.categories.name.valid).toBe(true);
    expect(verdict.categories.animal.feedback).toBe('Must start with the letter "L".');
  });
});
