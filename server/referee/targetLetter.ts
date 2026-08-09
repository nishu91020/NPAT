import { UserAnswers } from '../../shared/contract';
import { CATEGORY_KEYS, SCORING } from './scoring';
import { JudgeVerdict } from './types';

/**
 * Overrides the model on the one rule that needs no judgement.
 *
 * Whether a word starts with the target letter is mechanically decidable, so
 * there is no reason to trust a model for it — and models do get it wrong: a
 * strongly on-theme answer like "Tiger" under an India bonus was observed
 * scoring full marks for the letter S. Category validity and bonus matching
 * still need world knowledge, so those are left to the judge.
 */
export function enforceTargetLetter(
  verdict: JudgeVerdict,
  letter: string,
  answers: UserAnswers
): JudgeVerdict {
  const target = letter.trim().charAt(0).toUpperCase();
  const categories = { ...verdict.categories };
  let corrected = false;

  for (const key of CATEGORY_KEYS) {
    const word = (answers[key] || '').trim();
    const startsWithTarget = word.charAt(0).toUpperCase() === target;
    if (word && startsWithTarget) continue;

    const judged = categories[key];
    if (!judged.valid && !judged.bonusMatched) continue;

    corrected = true;
    categories[key] = {
      valid: false,
      bonusMatched: false,
      feedback: word
        ? `Must start with the letter "${target}".`
        : 'No answer provided.',
      // Keep the judge's suggestion only if it would itself have been accepted.
      suggestion:
        judged.suggestion && judged.suggestion.trim().charAt(0).toUpperCase() === target
          ? judged.suggestion
          : undefined,
    };
  }

  if (!corrected) return verdict;

  // The judge's own tally is no longer trustworthy once entries were corrected.
  const bonusMatches = CATEGORY_KEYS.filter((key) => categories[key].bonusMatched).length;

  return {
    ...verdict,
    categories,
    bonusChallengeMet: bonusMatches >= SCORING.bonusChallengeThreshold,
  };
}
