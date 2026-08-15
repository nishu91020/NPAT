import type { CategoryKey, UserAnswers } from '../shared/contract';

const ANSWER_KEYS: CategoryKey[] = ['name', 'place', 'animal', 'thing'];

export const MAX_ANSWER_LENGTH = 60;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

function readOneWord(value: string): string {
  return value.replace(CONTROL_CHARACTERS, ' ').slice(0, MAX_ANSWER_LENGTH);
}

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

    answers[key] = readOneWord(value);
  }

  return { answers };
}
