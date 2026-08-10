import { UserAnswers } from '../../shared/contract';
import { CATEGORY_KEYS, SCORING } from './scoring';
import { JudgeRequest, JudgeVerdict } from './types';

/** The single character every answer is measured against. */
export function targetLetterOf(letter: string): string {
  return (letter || '').trim().charAt(0).toUpperCase();
}

/** Whether an answer satisfies the letter rule. Trimmed and case-insensitive. */
export function startsWithTargetLetter(word: string, letter: string): boolean {
  const trimmed = (word || '').trim();
  return trimmed !== '' && trimmed.charAt(0).toUpperCase() === targetLetterOf(letter);
}

/**
 * The round as a judge should see it: answers trimmed, and any that fail the
 * letter rule blanked out.
 *
 * The judge is never shown an answer it could reject on letter grounds, which
 * is what stops it rejecting one on those grounds wrongly — observed live, the
 * model failed "Lizabeth" for the letter L with "first letter mismatch". A
 * blanked answer is settled by `enforceTargetLetter` afterwards, from the
 * player's original words.
 */
export function withOnlyMatchingLetters(request: JudgeRequest): JudgeRequest {
  const answers = { ...request.answers };

  for (const key of CATEGORY_KEYS) {
    const word = (answers[key] || '').trim();
    answers[key] = startsWithTargetLetter(word, request.letter) ? word : '';
  }

  return { ...request, answers };
}

/**
 * Settles the one rule that needs no judgement, in both directions.
 *
 * Whether a word starts with the target letter is mechanically decidable, so
 * there is no reason to trust a model for it — and models get it wrong both
 * ways: a strongly on-theme answer like "Tiger" was observed scoring full marks
 * for the letter S, and "Lizabeth" was observed failing for the letter L. An
 * answer that matches the letter keeps the judge's ruling; one that does not is
 * failed here, with the letter rule as its stated reason. Category validity and
 * bonus matching still need world knowledge, so those are left to the judge.
 */
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

    // The judge is shown a blank in place of a wrong-letter answer, so its
    // reason describes a blank rather than the word the player wrote.
    if (!judged.valid && !judged.bonusMatched && judged.feedback === feedback) continue;

    corrected = true;
    categories[key] = {
      valid: false,
      bonusMatched: false,
      feedback,
      // Keep the judge's suggestion only if it would itself have been accepted.
      // Only the letter is settled here; `enforceSuggestions` holds it to the
      // bonus rule as well, once the round's rule is known.
      suggestion: startsWithTargetLetter(judged.suggestion || '', letter)
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
