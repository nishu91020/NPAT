import { describe, expect, it } from 'vitest';
import { MAX_ANSWER_LENGTH, readAnswers } from './answers';

describe('reading the answers off a request', () => {
  it('takes four strings as they are', () => {
    const { answers, error } = readAnswers({
      name: 'Sam',
      place: 'Spain',
      animal: 'Snake',
      thing: 'Spoon',
    });

    expect(error).toBeUndefined();
    expect(answers).toEqual({ name: 'Sam', place: 'Spain', animal: 'Snake', thing: 'Spoon' });
  });

  it('reads a missing answer as blank, because a blank round is an ordinary round', () => {
    const { answers, error } = readAnswers({ name: 'Sam' });

    expect(error).toBeUndefined();
    expect(answers).toEqual({ name: 'Sam', place: '', animal: '', thing: '' });
  });

  /**
   * ⚠️ Everything downstream takes an answer for a string: the target letter
   * check trims it, the judge measures it. A number reached the referee and
   * threw, reporting a malformed request as though the server had failed.
   */
  it('refuses an answer that is not text, rather than letting the referee throw', () => {
    expect(readAnswers({ name: 42 }).error).toMatch(/name/);
    expect(readAnswers({ place: { toString: 'nope' } }).error).toMatch(/place/);
    expect(readAnswers({ animal: ['Snake'] }).error).toMatch(/animal/);
    expect(readAnswers({ thing: true }).error).toMatch(/thing/);
  });

  it('refuses anything that is not a set of answers at all', () => {
    expect(readAnswers(undefined).error).toBeTruthy();
    expect(readAnswers(null).error).toBeTruthy();
    expect(readAnswers('Sam').error).toBeTruthy();
    expect(readAnswers(['Sam']).error).toBeTruthy();
  });

  it('always answers with all four keys, even when it is refusing', () => {
    const { answers } = readAnswers({ name: 42 });
    expect(Object.keys(answers).sort()).toEqual(['animal', 'name', 'place', 'thing']);
  });

  it('cuts a pasted essay down to something judgeable', () => {
    const { answers, error } = readAnswers({ name: 'S'.repeat(5000) });

    expect(error).toBeUndefined();
    expect(answers.name).toHaveLength(MAX_ANSWER_LENGTH);
  });

  it('ignores fields nobody asked for', () => {
    const { answers, error } = readAnswers({ name: 'Sam', __proto__: { admin: true }, extra: 1 });

    expect(error).toBeUndefined();
    expect(answers).toEqual({ name: 'Sam', place: '', animal: '', thing: '' });
  });
});
