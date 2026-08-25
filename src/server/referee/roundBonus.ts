import { BonusChallenge, CategoryKey, UserAnswers } from '../../shared/contract';
import { CATEGORY_KEYS, bonusMetFor } from './scoring';
import { startsWithTargetLetter } from './roundGuardrails';
import { JudgeVerdict } from './types';

export interface BonusEntry {
  category: CategoryKey;
  word: string;
}

export interface BonusAdjudicationRequest {
  letter: string;
  bonusChallenge: BonusChallenge;

  submissions: UserAnswers[];
}

export interface BonusRuling {
  matched(category: CategoryKey, word: string): boolean | null;
}

export const NO_RULING: BonusRuling = { matched: () => null };

export interface BonusAdjudicator {
  adjudicate(request: BonusAdjudicationRequest): Promise<BonusRuling>;
}

export function bonusEntryKey(category: CategoryKey, word: string): string {
  return `${category}:${(word || '').trim().toLowerCase()}`;
}

export function needsAdjudication(challenge: BonusChallenge | undefined): boolean {
  const rule = challenge?.rule;
  return !rule || rule.checkKind === 'none';
}

export function bonusEntriesFor(request: BonusAdjudicationRequest): BonusEntry[] {
  const scope = request.bonusChallenge?.rule?.scope;
  const scopedToOne = scope !== undefined && scope !== 'all' && scope !== 'some';

  const seen = new Set<string>();
  const entries: BonusEntry[] = [];

  for (const answers of request.submissions) {
    for (const category of CATEGORY_KEYS) {
      if (scopedToOne && scope !== category) continue;

      const word = (answers?.[category] || '').trim();
      if (!startsWithTargetLetter(word, request.letter)) continue;

      const key = bonusEntryKey(category, word);
      if (seen.has(key)) continue;

      seen.add(key);
      entries.push({ category, word });
    }
  }

  return entries;
}

export function rulingFrom(decided: Map<string, boolean>): BonusRuling {
  return {
    matched(category, word) {
      const found = decided.get(bonusEntryKey(category, word));
      return found === undefined ? null : found;
    },
  };
}

export function applyBonusRuling(
  verdict: JudgeVerdict,
  answers: UserAnswers,
  challenge: BonusChallenge | undefined,
  ruling: BonusRuling
): JudgeVerdict {
  const categories = { ...verdict.categories };
  let changed = false;

  for (const key of CATEGORY_KEYS) {
    const judged = categories[key];
    const decided = ruling.matched(key, answers[key] || '');
    if (decided === null) continue;

    const matched = decided && judged.valid;
    if (matched === judged.bonusMatched) continue;

    changed = true;
    categories[key] = { ...judged, bonusMatched: matched };
  }

  if (!changed) return verdict;

  const matchedKeys = CATEGORY_KEYS.filter((key) => categories[key].bonusMatched);

  return {
    ...verdict,
    categories,

    bonusChallengeMet: bonusMetFor(challenge?.rule?.scope ?? 'some', matchedKeys),
  };
}

export async function sharedBonusRuling(
  adjudicator: BonusAdjudicator | undefined,
  request: BonusAdjudicationRequest
): Promise<BonusRuling> {
  if (!adjudicator) return NO_RULING;
  if (request.submissions.length < 2) return NO_RULING;
  if (!needsAdjudication(request.bonusChallenge)) return NO_RULING;
  if (bonusEntriesFor(request).length === 0) return NO_RULING;

  try {
    return await adjudicator.adjudicate(request);
  } catch (err) {
    console.error('Bonus adjudication failed; falling back to per-player rulings:', err);
    return NO_RULING;
  }
}
