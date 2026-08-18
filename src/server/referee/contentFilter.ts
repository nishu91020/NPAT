import { CategoryKey, UserAnswers } from '../../shared/contract';
import { CategoryJudgement, JudgeRequest } from './types';

export const UNSCOREABLE: CategoryJudgement = {
  valid: false,
  bonusMatched: false,
  feedback: "We couldn't check this one — try a different word.",
};

const EMPTY_ANSWERS: UserAnswers = { name: '', place: '', animal: '', thing: '' };

export function unscoreableCategories(categories: Record<CategoryKey, CategoryJudgement>) {
  return (Object.keys(categories) as CategoryKey[]).filter(
    (key) => categories[key].feedback === UNSCOREABLE.feedback
  );
}

export function onlyCategory(request: JudgeRequest, key: CategoryKey): JudgeRequest {
  return {
    ...request,
    answers: { ...EMPTY_ANSWERS, [key]: request.answers[key] },
  };
}

export function withoutCategories(request: JudgeRequest, keys: Set<CategoryKey>): JudgeRequest {
  const answers = { ...request.answers };
  for (const key of keys) answers[key] = '';

  return { ...request, answers };
}
