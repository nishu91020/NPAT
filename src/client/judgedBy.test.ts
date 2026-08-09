import { describe, expect, it } from 'vitest';
import { isAiJudged } from './judgedBy';

describe('isAiJudged', () => {
  it('is true for the current AI referee', () => {
    expect(isAiJudged('azure')).toBe(true);
  });

  it('stays true for rounds saved during the Gemini era', () => {
    // judgedBy is persisted in localStorage, so this value arrives forever.
    expect(isAiJudged('gemini')).toBe(true);
  });

  it('is false for the heuristic, which must not claim to be an AI referee', () => {
    expect(isAiJudged('heuristic')).toBe(false);
  });

  it('is false for rounds saved before the field existed', () => {
    expect(isAiJudged(undefined)).toBe(false);
  });
});
