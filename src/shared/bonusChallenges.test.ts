import { describe, expect, it } from 'vitest';
import type { BonusScope, CategoryKey } from './contract';
import { BONUS_CHALLENGES, DETERMINISTIC_CHALLENGE_COUNT } from './bonusChallenges';

const CATEGORY_SCOPES: CategoryKey[] = ['name', 'place', 'animal', 'thing'];
const VALID_SCOPES: BonusScope[] = ['all', 'some', ...CATEGORY_SCOPES];

const MECHANICAL = BONUS_CHALLENGES.filter((c) => c.rule && c.rule.checkKind !== 'none');

describe('the built-in challenge pool', () => {
  it('is wide enough that a room match rarely repeats itself', () => {
    expect(BONUS_CHALLENGES.length).toBeGreaterThan(DETERMINISTIC_CHALLENGE_COUNT);
    expect(BONUS_CHALLENGES.length).toBeGreaterThanOrEqual(40);
  });

  it('keeps enough machine-checkable rules that the heuristic judge has work to do', () => {
    expect(MECHANICAL.length).toBeGreaterThanOrEqual(15);
  });

  it('has unique ids', () => {
    const ids = BONUS_CHALLENGES.map((c) => c.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique titles, so two rounds never look like the same challenge', () => {
    const titles = BONUS_CHALLENGES.map((c) => c.title);

    expect(new Set(titles).size).toBe(titles.length);
  });

  it('gives every challenge a rule and copy that fits the banner', () => {
    for (const challenge of BONUS_CHALLENGES) {
      expect(challenge.rule, challenge.id).toBeDefined();
      expect(challenge.ruleHint.trim().length, challenge.id).toBeGreaterThan(0);
      expect(challenge.description.length, challenge.id).toBeLessThanOrEqual(85);
      expect(challenge.title.length, challenge.id).toBeLessThanOrEqual(25);
    }
  });

  it('only uses scopes the scorer understands', () => {
    for (const challenge of BONUS_CHALLENGES) {
      expect(VALID_SCOPES, challenge.id).toContain(challenge.rule!.scope);
    }
  });

  it('never states a threshold a numeric check cannot use', () => {
    const numeric = BONUS_CHALLENGES.filter(
      (c) => c.rule?.checkKind === 'minLength' || c.rule?.checkKind === 'minVowels'
    );

    expect(numeric.length).toBeGreaterThan(0);
    for (const challenge of numeric) {
      expect(Number(challenge.rule!.checkValue), challenge.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives every endsWith rule an ending the checker can actually parse', () => {
    const endings = BONUS_CHALLENGES.filter((c) => c.rule?.checkKind === 'endsWith');

    expect(endings.length).toBeGreaterThan(0);
    for (const challenge of endings) {
      expect(challenge.rule!.checkValue, challenge.id).toMatch(/^[a-z]+(,\s*[a-z]+)*$/);
    }
  });

  it('never asks for the target letter, which every valid answer already earns', () => {
    for (const challenge of BONUS_CHALLENGES) {
      expect(challenge.description, challenge.id).not.toMatch(/start(s|ing)?\s+with/i);
      expect(challenge.title, challenge.id).not.toMatch(/start(s|ing)?\s+with/i);
    }
  });
});

describe('the frozen prefix', () => {
  it('is exactly the seven challenges every past date was derived from', () => {
    expect(DETERMINISTIC_CHALLENGE_COUNT).toBe(7);

    expect(BONUS_CHALLENGES.slice(0, DETERMINISTIC_CHALLENGE_COUNT).map((c) => c.id)).toEqual([
      'long_words',
      'india_focus',
      'edible_thing',
      'world_place',
      'wildlife_expert',
      'vowel_rich',
      'famous_name',
    ]);
  });

  it('is unmoved by everything appended after it', () => {
    const prefix = BONUS_CHALLENGES.slice(0, DETERMINISTIC_CHALLENGE_COUNT);

    expect(prefix[0].rule).toEqual({ scope: 'all', checkKind: 'minLength', checkValue: '5' });
    expect(prefix[DETERMINISTIC_CHALLENGE_COUNT - 1].id).toBe('famous_name');
  });
});
