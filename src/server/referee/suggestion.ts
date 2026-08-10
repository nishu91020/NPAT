import { BonusChallenge, CategoryKey, UserAnswers } from '../../shared/contract';
import { satisfiesCheck } from './bonusRule';
import { CATEGORY_KEYS } from './scoring';
import { startsWithTargetLetter } from './targetLetter';
import { JudgeVerdict } from './types';

/**
 * A suggestion is the game claiming "this would have worked", so it is held to
 * the same mechanical rules the player's own answer was.
 *
 * Observed live: under the letter H with a "must contain 'hh'" challenge, a
 * rejected Name was offered "Rhythm" — which is not a name, does not start with
 * H, and has no double H. The category is world knowledge and stays with the
 * judge, but the letter and the mechanical part of the bonus rule are checkable
 * here, and a suggestion that fails either is worse than none at all.
 */
export function suggestionStands(
  suggestion: string | undefined,
  key: CategoryKey,
  letter: string,
  challenge: BonusChallenge | undefined
): boolean {
  const word = (suggestion || '').trim();
  if (!word) return false;
  if (!startsWithTargetLetter(word, letter)) return false;

  const rule = challenge?.rule;
  if (!rule) return true;

  // Only a rule every answer must satisfy can condemn a single word. A rule
  // naming one category asks nothing of the other three, and a "some" rule asks
  // only that SCORING.bonusChallengeThreshold answers match — so a suggestion
  // failing it may still be one of the answers that was never required to.
  if (rule.scope !== 'all' && rule.scope !== key) return true;

  // null means only a judge could say; that is not evidence against the word.
  return satisfiesCheck(rule, word) !== false;
}

/** Drops every suggestion the game cannot stand behind. */
export function enforceSuggestions(
  verdict: JudgeVerdict,
  letter: string,
  challenge: BonusChallenge | undefined,
  answers: UserAnswers
): JudgeVerdict {
  const categories = { ...verdict.categories };
  let dropped = false;

  for (const key of CATEGORY_KEYS) {
    const judged = categories[key];
    if (judged.suggestion === undefined) continue;

    // Offering back the very word just rejected contradicts the ruling above it.
    const repeatsTheAnswer =
      judged.suggestion.trim().toLowerCase() === (answers[key] || '').trim().toLowerCase();

    if (!repeatsTheAnswer && suggestionStands(judged.suggestion, key, letter, challenge)) continue;

    dropped = true;
    categories[key] = { ...judged, suggestion: undefined };
  }

  return dropped ? { ...verdict, categories } : verdict;
}
