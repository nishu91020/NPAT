import { BonusChallenge, CategoryKey, UserAnswers } from '../../shared/contract';
import { CATEGORY_KEYS, bonusMetFor } from './scoring';
import { startsWithTargetLetter } from './targetLetter';
import { JudgeVerdict } from './types';

/** One answer to be ruled on, as the adjudicator is shown it. */
export interface BonusEntry {
  category: CategoryKey;
  word: string;
}

/** Everyone's answers to one round, plus the challenge they were all played under. */
export interface BonusAdjudicationRequest {
  letter: string;
  bonusChallenge: BonusChallenge;
  /** One entry per player, in no particular order — the ruling is per word, not per player. */
  submissions: UserAnswers[];
}

/**
 * A settled reading of one round's bonus rule.
 *
 * `null` means the answer was not ruled on, and the judge's own verdict stands.
 */
export interface BonusRuling {
  matched(category: CategoryKey, word: string): boolean | null;
}

/** Rules on nothing: every judge keeps its own verdict. */
export const NO_RULING: BonusRuling = { matched: () => null };

/**
 * Rules on a whole round at once, so every player is held to one reading of the rule.
 *
 * The seam exists because a knowledge-based bonus rule — "two answers must relate
 * to a colour" — is the one thing in a round that is neither mechanically decidable
 * nor safely left to a per-player call. Players in a room are judged in separate
 * requests, so the model was applying such a rule independently per player and
 * awarding the bonus to one player and not another for equally good answers.
 */
export interface BonusAdjudicator {
  adjudicate(request: BonusAdjudicationRequest): Promise<BonusRuling>;
}

/** The identity of an answer for ruling purposes: a word in a category, however typed. */
export function bonusEntryKey(category: CategoryKey, word: string): string {
  return `${category}:${(word || '').trim().toLowerCase()}`;
}

/**
 * Whether the round's rule is one a model has to settle at all.
 *
 * A rule with a mechanical check is already decided in code by `enforceBonusRule`,
 * identically for every player, so adjudicating it would spend a call to be
 * overruled. A challenge with no rule predates rules entirely and is judged.
 */
export function needsAdjudication(challenge: BonusChallenge | undefined): boolean {
  const rule = challenge?.rule;
  return !rule || rule.checkKind === 'none';
}

/**
 * The distinct answers worth ruling on.
 *
 * Blank answers score nothing, wrong-letter answers are failed before any model
 * sees them, and a rule naming one category refuses the other three the bonus
 * outright — so none of them is asked about. Duplicates collapse: two players who
 * wrote the same word are asking the same question, and asking it once is what
 * guarantees they get the same answer.
 */
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

/** Turns a set of decided entries into a ruling, leaving anything absent unruled. */
export function rulingFrom(decided: Map<string, boolean>): BonusRuling {
  return {
    matched(category, word) {
      const found = decided.get(bonusEntryKey(category, word));
      return found === undefined ? null : found;
    },
  };
}

/**
 * Applies a round-wide ruling to one player's verdict.
 *
 * Runs before `enforceBonusRule`, so a mechanical rule still overrules this the
 * same way it overrules the judge: code first, one shared reading second, the
 * per-player judge last.
 */
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

    // An answer that is not a real member of its category never earns the bonus,
    // and the adjudicator is deliberately not asked about validity.
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
    // The judge's own tally described rulings that no longer stand.
    bonusChallengeMet: bonusMetFor(challenge?.rule?.scope ?? 'some', matchedKeys),
  };
}

/**
 * The ruling for a round, or `NO_RULING` when there is nothing to settle.
 *
 * Never throws: a failed adjudication costs consistency, which is exactly the
 * behaviour without one, and must not cost anybody their round. One racer is
 * skipped too — there is no second player to be inconsistent with, and a model
 * call nobody can benefit from is one nobody should pay for.
 */
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
