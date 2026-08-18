import { describe, expect, it, vi } from 'vitest';
import { BonusChallenge, CategoryKey, UserAnswers } from '../../shared/contract';
import { CATEGORY_KEYS } from './scoring';
import {
  BonusAdjudicator,
  NO_RULING,
  applyBonusRuling,
  bonusEntriesFor,
  bonusEntryKey,
  needsAdjudication,
  rulingFrom,
  sharedBonusRuling,
} from './roundBonus';
import { CategoryJudgement, JudgeVerdict } from './types';

const colours: BonusChallenge = {
  id: 'colour_theme',
  title: 'Shade Squad',
  description: 'At least 2 answers must relate to a colour.',
  icon: 'Sparkles',
  ruleHint: 'Two answers should relate to a colour.',
  rule: { scope: 'some', checkKind: 'none', checkValue: '' },
};

const answers = (over: Partial<UserAnswers> = {}): UserAnswers => ({
  name: '',
  place: '',
  animal: '',
  thing: '',
  ...over,
});

function judgement(over: Partial<CategoryJudgement> = {}): CategoryJudgement {
  return { valid: true, bonusMatched: false, feedback: '', ...over };
}

function verdict(over: Partial<Record<CategoryKey, CategoryJudgement>> = {}): JudgeVerdict {
  const categories = {} as Record<CategoryKey, CategoryJudgement>;
  for (const key of CATEGORY_KEYS) categories[key] = over[key] ?? judgement();
  return { judgedBy: 'azure', categories, bonusChallengeMet: false };
}

function ruling(entries: Record<string, boolean>) {
  return rulingFrom(new Map(Object.entries(entries)));
}

describe('needsAdjudication', () => {
  it('is true for a rule needing world knowledge, which no code can settle', () => {
    expect(needsAdjudication(colours)).toBe(true);
  });

  it('is true for a challenge with no rule, since only a judge can read it', () => {
    expect(needsAdjudication({ ...colours, rule: undefined })).toBe(true);
  });

  it('is false for a mechanical rule, already settled identically for everyone', () => {
    expect(
      needsAdjudication({
        ...colours,
        rule: { scope: 'some', checkKind: 'minLength', checkValue: '5' },
      })
    ).toBe(false);
  });
});

describe('bonusEntriesFor', () => {
  it('asks about the same word once however many players wrote it', () => {
    const entries = bonusEntriesFor({
      letter: 'R',
      bonusChallenge: colours,
      submissions: [answers({ thing: 'Rose' }), answers({ thing: 'rose ' })],
    });

    expect(entries).toEqual([{ category: 'thing', word: 'Rose' }]);
  });

  it('skips blanks and wrong-letter answers, which are failed before any model sees them', () => {
    const entries = bonusEntriesFor({
      letter: 'R',
      bonusChallenge: colours,
      submissions: [answers({ name: 'Ruby', place: '', animal: 'Tiger' })],
    });

    expect(entries).toEqual([{ category: 'name', word: 'Ruby' }]);
  });

  it('asks only about the category a scoped rule names', () => {
    const entries = bonusEntriesFor({
      letter: 'R',
      bonusChallenge: { ...colours, rule: { scope: 'thing', checkKind: 'none', checkValue: '' } },
      submissions: [answers({ name: 'Ruby', thing: 'Rug' })],
    });

    expect(entries).toEqual([{ category: 'thing', word: 'Rug' }]);
  });
});

describe('applyBonusRuling', () => {
  it('overrules a judge that awarded a bonus the round did not', () => {
    const applied = applyBonusRuling(
      verdict({ thing: judgement({ bonusMatched: true }) }),
      answers({ thing: 'Rug' }),
      colours,
      ruling({ [bonusEntryKey('thing', 'Rug')]: false })
    );

    expect(applied.categories.thing.bonusMatched).toBe(false);
  });

  it('awards a bonus the judge withheld, so equal answers are treated equally', () => {
    const applied = applyBonusRuling(
      verdict(),
      answers({ thing: 'Rose', name: 'Ruby' }),
      colours,
      ruling({
        [bonusEntryKey('thing', 'Rose')]: true,
        [bonusEntryKey('name', 'Ruby')]: true,
      })
    );

    expect(applied.categories.thing.bonusMatched).toBe(true);
    expect(applied.categories.name.bonusMatched).toBe(true);

    expect(applied.bonusChallengeMet).toBe(true);
  });

  it('matches on the word, not the player, so the same word rules the same way', () => {
    const settled = ruling({ [bonusEntryKey('thing', 'rose')]: true });

    const first = applyBonusRuling(verdict(), answers({ thing: 'Rose' }), colours, settled);
    const second = applyBonusRuling(verdict(), answers({ thing: ' ROSE ' }), colours, settled);

    expect(first.categories.thing.bonusMatched).toBe(true);
    expect(second.categories.thing.bonusMatched).toBe(true);
  });

  it('never awards a bonus to an answer the judge failed', () => {
    const applied = applyBonusRuling(
      verdict({ animal: judgement({ valid: false }) }),
      answers({ animal: 'Redbeast' }),
      colours,
      ruling({ [bonusEntryKey('animal', 'Redbeast')]: true })
    );

    expect(applied.categories.animal.bonusMatched).toBe(false);
  });

  it('leaves an unruled answer to its own judge', () => {
    const original = verdict({ thing: judgement({ bonusMatched: true }) });

    expect(applyBonusRuling(original, answers({ thing: 'Rug' }), colours, NO_RULING)).toBe(
      original
    );
  });

  it('counts a scoped rule by its own scope, not by a threshold', () => {
    const scoped: BonusChallenge = {
      ...colours,
      rule: { scope: 'thing', checkKind: 'none', checkValue: '' },
    };

    const applied = applyBonusRuling(
      verdict(),
      answers({ thing: 'Rose' }),
      scoped,
      ruling({ [bonusEntryKey('thing', 'Rose')]: true })
    );

    expect(applied.bonusChallengeMet).toBe(true);
  });
});

describe('sharedBonusRuling', () => {
  const request = {
    letter: 'R',
    bonusChallenge: colours,
    submissions: [answers({ thing: 'Rose' }), answers({ thing: 'Rug' })],
  };

  function fakeAdjudicator(entries: Record<string, boolean>) {
    const adjudicate = vi.fn(async () => ruling(entries));
    return { adjudicator: { adjudicate } as BonusAdjudicator, adjudicate };
  }

  it('settles the round once for everybody', async () => {
    const { adjudicator, adjudicate } = fakeAdjudicator({
      [bonusEntryKey('thing', 'Rose')]: true,
    });

    const settled = await sharedBonusRuling(adjudicator, request);

    expect(adjudicate).toHaveBeenCalledTimes(1);
    expect(settled.matched('thing', 'Rose')).toBe(true);
  });

  it('rules on nothing when there is no adjudicator', async () => {
    expect(await sharedBonusRuling(undefined, request)).toBe(NO_RULING);
  });

  it('skips a mechanical rule, which code already settles the same way for everyone', async () => {
    const { adjudicator, adjudicate } = fakeAdjudicator({});

    await sharedBonusRuling(adjudicator, {
      ...request,
      bonusChallenge: {
        ...colours,
        rule: { scope: 'some', checkKind: 'minLength', checkValue: '5' },
      },
    });

    expect(adjudicate).not.toHaveBeenCalled();
  });

  it('skips a lone racer, who has nobody to be inconsistent with', async () => {
    const { adjudicator, adjudicate } = fakeAdjudicator({});

    await sharedBonusRuling(adjudicator, { ...request, submissions: [answers({ thing: 'Rose' })] });

    expect(adjudicate).not.toHaveBeenCalled();
  });

  it('skips a round with nothing scoreable in it', async () => {
    const { adjudicator, adjudicate } = fakeAdjudicator({});

    await sharedBonusRuling(adjudicator, {
      ...request,
      submissions: [answers(), answers({ thing: 'Tulip' })],
    });

    expect(adjudicate).not.toHaveBeenCalled();
  });

  it('costs consistency, never a round, when the adjudication fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const adjudicator: BonusAdjudicator = {
      adjudicate: async () => {
        throw new Error('model unavailable');
      },
    };

    expect(await sharedBonusRuling(adjudicator, request)).toBe(NO_RULING);
    spy.mockRestore();
  });
});
