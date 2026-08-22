import { describe, expect, it } from 'vitest';
import { nonNegativeInt, positiveInt } from './env';

describe('positiveInt', () => {
  it('reads a number', () => {
    expect(positiveInt('25', 10)).toBe(25);
  });

  it('falls back when the variable is unset', () => {
    expect(positiveInt(undefined, 10)).toBe(10);
  });

  it('falls back for the empty value that .env.example ships', () => {
    expect(positiveInt('', 10)).toBe(10);
    expect(positiveInt('   ', 10)).toBe(10);
  });

  it('falls back rather than disabling the thing it configures', () => {
    expect(positiveInt('0', 10)).toBe(10);
    expect(positiveInt('-5', 10)).toBe(10);
  });

  it('falls back for values that are not whole numbers', () => {
    expect(positiveInt('abc', 10)).toBe(10);
    expect(positiveInt('2.5', 10)).toBe(10);
  });
});

describe('nonNegativeInt', () => {
  it('reads a number', () => {
    expect(nonNegativeInt('2', 1)).toBe(2);
  });

  it('keeps an explicit zero, which is a real choice here', () => {
    expect(nonNegativeInt('0', 1)).toBe(0);
  });

  it('falls back for the empty value that .env.example ships, rather than reading it as zero', () => {
    expect(nonNegativeInt('', 1)).toBe(1);
    expect(nonNegativeInt('   ', 1)).toBe(1);
    expect(nonNegativeInt(undefined, 1)).toBe(1);
  });

  it('falls back for nonsense', () => {
    expect(nonNegativeInt('-1', 1)).toBe(1);
    expect(nonNegativeInt('abc', 1)).toBe(1);
  });
});
