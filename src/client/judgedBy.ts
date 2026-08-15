import { JudgedBy } from '../shared/contract';

export function isAiJudged(judgedBy: JudgedBy | undefined): boolean {
  return judgedBy === 'azure' || judgedBy === 'gemini';
}
