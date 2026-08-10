import { BonusChallenge, CategoryKey, UserAnswers } from '../../shared/contract';
import { satisfiesCheck } from './bonusRule';
import { CATEGORY_KEYS } from './scoring';
import { startsWithTargetLetter } from './targetLetter';
import { JudgeVerdict } from './types';

/**
 * Whether the bonus rule can apply to this category at all.
 *
 * A rule naming one category asks nothing of the other three — `enforceBonusRule`
 * refuses them the bonus outright — so there is no answer they could have given
 * to earn it, and suggesting one would be a lie. A challenge with no `rule` is
 * judged, and the judge applies it to every category.
 */
export function bonusRuleApplies(challenge: BonusChallenge | undefined, key: CategoryKey): boolean {
  const scope = challenge?.rule?.scope;
  if (!scope) return Boolean(challenge);
  return scope === 'all' || scope === 'some' || scope === key;
}

/**
 * A suggestion is the game claiming "this would have worked", so it is held to
 * the same mechanical rules the player's own answer was.
 *
 * Observed live: under the letter H with a "must contain 'hh'" challenge, a
 * rejected Name was offered "Rhythm" — which is not a name, does not start with
 * H, and has no double H. The category is world knowledge and stays with the
 * judge, but the letter and the mechanical part of the bonus rule are checkable
 * here, and a suggestion that fails either is worse than none at all.
 *
 * `forBonus` says the suggestion exists *only* to show what would have earned
 * the bonus, which raises the bar: such a word must actually satisfy the rule,
 * including under a `some` scope where a mere correction would not have to.
 */
export function suggestionStands(
  suggestion: string | undefined,
  key: CategoryKey,
  letter: string,
  challenge: BonusChallenge | undefined,
  forBonus = false
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
  // A bonus suggestion has no such excuse: earning the bonus is its whole job.
  const binds = forBonus ? bonusRuleApplies(challenge, key) : rule.scope === 'all' || rule.scope === key;
  if (!binds) return true;

  // null means only a judge could say; that is not evidence against the word.
  return satisfiesCheck(rule, word) !== false;
}

/**
 * Drops every suggestion the game cannot stand behind, and holds a suggestion
 * offered for the bonus to a higher bar than one offered as a correction.
 *
 * A valid answer that missed the bonus still carries a suggestion, because the
 * bonus is scored per category — each match is worth
 * `SCORING.validAnswerWithBonus - SCORING.validAnswer` — so a category that
 * missed it lost points of its own, whether or not the round met the challenge
 * overall. There is nothing to show when the answer already matched, and nothing
 * honest to show when the rule could never have applied to that category.
 */
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

    // A valid answer only needs advice about the bonus, so that is the only
    // reason to keep one — and only where the bonus was actually available.
    const forBonus = judged.valid;
    const worthGiving = forBonus
      ? !judged.bonusMatched && bonusRuleApplies(challenge, key)
      : true;

    // Offering back the very word just rejected contradicts the ruling above it.
    const repeatsTheAnswer =
      judged.suggestion.trim().toLowerCase() === (answers[key] || '').trim().toLowerCase();

    if (
      worthGiving &&
      !repeatsTheAnswer &&
      suggestionStands(judged.suggestion, key, letter, challenge, forBonus)
    ) {
      continue;
    }

    dropped = true;
    categories[key] = { ...judged, suggestion: undefined };
  }

  return dropped ? { ...verdict, categories } : verdict;
}
