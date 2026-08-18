import { BonusChallenge, CategoryKey, UserAnswers } from '../../shared/contract';
import { satisfiesCheck } from './bonusRule';
import { CATEGORY_KEYS } from './scoring';
import { startsWithTargetLetter } from './targetLetter';
import { JudgeVerdict } from './types';

export function bonusRuleApplies(challenge: BonusChallenge | undefined, key: CategoryKey): boolean {
  const scope = challenge?.rule?.scope;
  if (!scope) return Boolean(challenge);
  return scope === 'all' || scope === 'some' || scope === key;
}

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

  const binds = forBonus ? bonusRuleApplies(challenge, key) : rule.scope === 'all' || rule.scope === key;
  if (!binds) return true;

  return satisfiesCheck(rule, word) !== false;
}

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

    const forBonus = judged.valid;
    const worthGiving = forBonus
      ? !judged.bonusMatched && bonusRuleApplies(challenge, key)
      : true;

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
