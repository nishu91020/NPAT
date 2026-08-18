import { UserAnswers } from '../../shared/contract';
import { CATEGORY_KEYS, SCORING } from './scoring';
import { JudgeRequest, JudgeVerdict } from './types';

export function targetLetterOf(letter: string): string {
  return (letter || '').trim().charAt(0).toUpperCase();
}

export function startsWithTargetLetter(word: string, letter: string): boolean {
  const trimmed = (word || '').trim();
  return trimmed !== '' && trimmed.charAt(0).toUpperCase() === targetLetterOf(letter);
}

export function withOnlyMatchingLetters(request: JudgeRequest): JudgeRequest {
  const answers = { ...request.answers };

  for (const key of CATEGORY_KEYS) {
    const word = (answers[key] || '').trim();
    answers[key] = startsWithTargetLetter(word, request.letter) ? word : '';
  }

  return { ...request, answers };
}

export function enforceTargetLetter(
  verdict: JudgeVerdict,
  letter: string,
  answers: UserAnswers
): JudgeVerdict {
  const target = targetLetterOf(letter);
  const categories = { ...verdict.categories };
  let corrected = false;

  for (const key of CATEGORY_KEYS) {
    const word = (answers[key] || '').trim();
    if (startsWithTargetLetter(word, letter)) continue;

    const judged = categories[key];
    const feedback = word
      ? `Must start with the letter "${target}".`
      : 'No answer provided.';

    if (!judged.valid && !judged.bonusMatched && judged.feedback === feedback) continue;

    corrected = true;
    categories[key] = {
      valid: false,
      bonusMatched: false,
      feedback,

      suggestion: startsWithTargetLetter(judged.suggestion || '', letter)
        ? judged.suggestion
        : undefined,
    };
  }

  if (!corrected) return verdict;

  const bonusMatches = CATEGORY_KEYS.filter((key) => categories[key].bonusMatched).length;

  return {
    ...verdict,
    categories,
    bonusChallengeMet: bonusMatches >= SCORING.bonusChallengeThreshold,
  };
}
