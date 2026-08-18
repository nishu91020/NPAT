import { BonusChallenge, CategoryKey } from '../../shared/contract';
import { CATEGORY_KEYS } from './scoring';
import { startsWithTargetLetter, targetLetterOf } from './targetLetter';
import { CategoryJudgement, Judge, JudgeRequest, JudgeVerdict } from './types';

const VERIFIABLE_BONUS_RULES: Record<string, (word: string, key: CategoryKey) => boolean> = {
  long_words: (word) => word.length >= 5,
  vowel_rich: (word) => (word.match(/[aeiouAEIOU]/g) || []).length >= 2,
};

function matchesBonus(challenge: BonusChallenge, word: string, key: CategoryKey): boolean {
  const rule = VERIFIABLE_BONUS_RULES[challenge.id];
  return rule ? rule(word, key) : false;
}

function judgeCategory(
  key: CategoryKey,
  rawAnswer: string,
  targetLetter: string,
  bonusChallenge: BonusChallenge
): CategoryJudgement {
  const word = (rawAnswer || '').trim();

  if (!word) {
    return { valid: false, bonusMatched: false, feedback: 'No answer provided.' };
  }

  if (!startsWithTargetLetter(word, targetLetter)) {
    return {
      valid: false,
      bonusMatched: false,
      feedback: `Must start with the letter "${targetLetter}".`,
    };
  }

  const valid = word.length >= 2;
  if (!valid) {
    return { valid: false, bonusMatched: false, feedback: `Invalid entry for ${key}.` };
  }

  const bonusMatched = matchesBonus(bonusChallenge, word, key);

  return {
    valid: true,
    bonusMatched,
    feedback: bonusMatched
      ? `Great! Starts with "${targetLetter}" & satisfies the daily bonus!`
      : `Valid answer starting with "${targetLetter}".`,
  };
}

export const heuristicJudge: Judge = {
  async judge({ letter, answers, bonusChallenge }: JudgeRequest): Promise<JudgeVerdict> {
    const targetLetter = targetLetterOf(letter);
    const categories = {} as Record<CategoryKey, CategoryJudgement>;

    for (const key of CATEGORY_KEYS) {
      categories[key] = judgeCategory(key, answers[key], targetLetter, bonusChallenge);
    }

    return { judgedBy: 'heuristic', categories };
  },
};
