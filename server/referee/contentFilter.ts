import { CategoryKey, UserAnswers } from '../../src/types';
import { CategoryJudgement, JudgeRequest } from './types';
/**
 * Raised when Microsoft Foundry's content filter rejects a request. Distinct
 * from a transient failure: it is permanent for that content, so retrying the
 * same request unchanged would fail identically.
 */
export class ContentFilterError extends Error {
  readonly harmCategories: string[];

  constructor(message: string, harmCategories: string[] = []) {
    super(message);
    this.name = 'ContentFilterError';
    this.harmCategories = harmCategories;
  }
}

/** What the player sees for an answer the filter would not let us check. */
export const UNSCOREABLE: CategoryJudgement = {
  valid: false,
  bonusMatched: false,
  feedback: "We couldn't check this one — try a different word.",
};

/** Recognises the documented content-filter rejection shape. */
export function isContentFilterRejection(err: unknown): boolean {
  const anyErr = err as
    | { status?: number; code?: string; error?: { code?: string }; message?: string }
    | undefined;
  if (!anyErr) return false;

  const code = anyErr.code ?? anyErr.error?.code;
  if (code === 'content_filter') return true;

  return anyErr.status === 400 && Boolean(anyErr.message?.includes('content_filter'));
}

export function harmCategoriesFrom(err: unknown): string[] {
  const inner = (err as any)?.error?.innererror ?? (err as any)?.innererror;
  const result = inner?.content_filter_result;
  if (!result || typeof result !== 'object') return [];

  return Object.entries(result)
    .filter(([, value]) => (value as { filtered?: boolean })?.filtered)
    .map(([category]) => category);
}

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
