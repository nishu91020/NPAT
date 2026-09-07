import { describe, expect, it } from 'vitest';
import { RULE_FAMILIES } from './ruleFamilies';

describe('RULE_FAMILIES', () => {
  it('contains a non-empty set of distinct rule families', () => {
    expect(RULE_FAMILIES.length).toBeGreaterThan(0);
    expect(new Set(RULE_FAMILIES).size).toBe(RULE_FAMILIES.length);

    for (const family of RULE_FAMILIES) {
      expect(family.trim().length).toBeGreaterThan(0);
      expect(family.toLowerCase()).toContain('rule');
    }
  });
});
