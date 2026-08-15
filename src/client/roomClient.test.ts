import { describe, expect, it } from 'vitest';
import { secondsLeft } from './roomClient';

const round = (remainingMs: number) => ({
  endsAt: new Date(1_000_000 + remainingMs).toISOString(),
  serverNow: new Date(1_000_000).toISOString(),
});

describe('the room countdown', () => {
  it('measures against the server clock, not the browser', () => {
    expect(secondsLeft(round(60_000), 0)).toBe(60);
    expect(secondsLeft(round(60_000), 45_000)).toBe(15);
  });

  it('never floors at zero, so a blip cannot rewind the clock', () => {
    expect(secondsLeft(round(60_000), 90_000)).toBe(0);
  });

  /**
   * ⚠️ Zero is the buzzer: it is what makes every client auto-submit. Reaching it
   * early would land the submission before the deadline, where the server takes
   * it as an ordinary on-time answer and reports that everyone finished.
   */
  it('does not reach zero before the deadline actually passes', () => {
    expect(secondsLeft(round(60_000), 59_600)).toBe(1);
    expect(secondsLeft(round(60_000), 59_999)).toBe(1);
    expect(secondsLeft(round(60_000), 60_000)).toBe(0);
  });
});
