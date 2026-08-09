import { CategoryKey, UserAnswers } from '../../shared/contract';
import { CategoryJudgement, JudgeRequest } from './types';

/**
 * How the game responds when the content filter refuses to judge an answer.
 *
 * The error itself and its detectors are transport concerns and live with the
 * completer in `server/azure/structuredCompletion.ts`; what remains here is the
 * domain decision — one answer becomes unscoreable, the round still scores.
 */

/** What the player sees for an answer the filter would not let us check. */
export const UNSCOREABLE: CategoryJudgement = {
  valid: false,
  bonusMatched: false,
  feedback: "We couldn't check this one — try a different word.",
};

const EMPTY_ANSWERS: UserAnswers = { name: '', place: '', animal: '', thing: '' };

/**
 * Which categories the content filter refused to judge.
 *
 * Recognised by identity with UNSCOREABLE's feedback rather than by a flag,
 * because the judgement type is deliberately narrow — but exposed here so
 * callers do not string-match it themselves.
 */
export function unscoreableCategories(categories: Record<CategoryKey, CategoryJudgement>) {
  return (Object.keys(categories) as CategoryKey[]).filter(
    (key) => categories[key].feedback === UNSCOREABLE.feedback
  );
}

/** The round with only one answer present, used to attribute a rejection. */
export function onlyCategory(request: JudgeRequest, key: CategoryKey): JudgeRequest {
  return {
    ...request,
    answers: { ...EMPTY_ANSWERS, [key]: request.answers[key] },
  };
}

/** The round with the unscoreable answers blanked, so the rest can still be judged. */
export function withoutCategories(request: JudgeRequest, keys: Set<CategoryKey>): JudgeRequest {
  const answers = { ...request.answers };
  for (const key of keys) answers[key] = '';

  return { ...request, answers };
}
