import { JudgedBy } from '../shared/contract';

/**
 * Whether a round was ruled on by an AI referee rather than the local
 * heuristic.
 *
 * `judgedBy` is persisted inside saved rounds in localStorage, so values from
 * earlier releases keep arriving forever: rounds judged before this field
 * existed have it undefined, and rounds judged during the Gemini era carry
 * 'gemini'. Both must still render correctly.
 */
export function isAiJudged(judgedBy: JudgedBy | undefined): boolean {
  return judgedBy === 'azure' || judgedBy === 'gemini';
}
