import type { CategoryKey, UserAnswers } from '../shared/contract';

const ANSWER_KEYS: CategoryKey[] = ['name', 'place', 'animal', 'thing'];

/** An answer is one word. Anything past this is a paste, and is cut rather than judged. */
export const MAX_ANSWER_LENGTH = 60;

/**
 * Turns whatever arrived on the wire into exactly four strings.
 *
 * ⚠️ Everything downstream assumes an answer is a string — the target letter
 * check trims it, the judge measures its length, the prompts interpolate it. A
 * number, an object or an array therefore reached the referee and threw, which
 * reported a malformed request as a 500, as though the server were at fault.
 *
 * Absent is fine and means blank: a player who submits nothing, or whose clock
 * submits for them, is an ordinary round. The wrong *type* is not, and is
 * refused here rather than part-way through scoring.
 *
 * Returned rather than thrown so both callers — the solo round and the room —
 * can answer with their own 400 without sharing an error class.
 */
export function readAnswers(raw: unknown): { answers: UserAnswers; error?: string } {
  const answers: UserAnswers = { name: '', place: '', animal: '', thing: '' };

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { answers, error: 'Missing answers.' };
  }

  const source = raw as Record<string, unknown>;

  for (const key of ANSWER_KEYS) {
    const value = source[key];

    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      return { answers, error: `The ${key} answer must be text.` };
    }

    answers[key] = value.slice(0, MAX_ANSWER_LENGTH);
  }

  return { answers };
}
