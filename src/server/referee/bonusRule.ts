import { BonusChallenge, BonusRule, CategoryKey } from '../../shared/contract';
import { CATEGORY_KEYS, bonusMetFor } from './scoring';
import { JudgeVerdict } from './types';

const VOWELS = /[aeiou]/gi;
const ENDS_IN_VOWEL = /[aeiou]$/i;

/** Separators a model writes a genuine list of endings with. */
const LIST_SEPARATORS = /\s*[,/|]\s*/;
/** "or" joining two endings — only a separator when it is not the ending itself. */
const OR_SEPARATOR = /\s*\bor\b\s*/i;

/**
 * The endings an `endsWith` rule will accept.
 *
 * A rule is written once as prose and once as a check, and the prose leaks into
 * the check: "must end in a vowel" arrived as checkValue "a, e, i, o, u", and no
 * word on earth ends with that string, so "Vase" scored nothing under a rule it
 * plainly satisfied. Reading the value as a list of alternatives settles that
 * case exactly — a word ending in any one of them satisfies the rule — without
 * having to guess what the author meant.
 *
 * "or" is split on only where it joins two endings, never where it IS one:
 * splitting it unconditionally turned the perfectly ordinary ending "-or" into
 * an empty list, which downgraded the rule to a judged one, and turned the list
 * "or, er" into just "er" — silently failing every word the rule allowed.
 */
export function endingsOf(checkValue: string): string[] {
  return (checkValue || '')
    .toLowerCase()
    .split(LIST_SEPARATORS)
    .flatMap((part) => (part.trim() === 'or' ? [part] : part.split(OR_SEPARATOR)))
    .map((ending) => ending.replace(/["'“”‘’`.]/g, '').trim())
    .map((ending) => ending.replace(/^(?:the\s+)?letters?\s+/, ''))
    .filter((ending) => /^[a-z]+$/.test(ending));
}

/** Whether an ending rule is really the "ends in a vowel" rule, however it was written. */
function namesAVowel(checkValue: string): boolean {
  return /vowel/i.test(checkValue || '');
}

/**
 * Compares a count against a threshold, refusing to decide without a usable one.
 *
 * `Number('')` is 0, so a missing threshold would otherwise be satisfied by every
 * word and hand out the bonus for free. Returning null hands the rule back to the
 * judge, which is merely the old behaviour rather than a wrong answer.
 */
function atLeast(count: number, rawThreshold: string): boolean | null {
  const threshold = Number(rawThreshold.trim() || NaN);
  // Number.isFinite matters as well as the bound: 'Infinity' parses to a number
  // greater than one, and no word could ever reach it.
  if (!Number.isFinite(threshold) || threshold < 1) return null;
  return count >= threshold;
}

/**
 * Whether a word satisfies a rule, or null when only a judge can say.
 *
 * Rules about the letters themselves are decided here rather than by the model,
 * for the same reason the target letter is: they are mechanically decidable, and
 * the model is not consistent about them. Asked to apply one identical rule to
 * one identical set of answers eight times, it produced three different verdicts
 * and scores from 65 to 80.
 */
export function satisfiesCheck(rule: BonusRule, rawWord: string): boolean | null {
  if (rule.checkKind === 'none') return null;

  const word = (rawWord || '').trim();
  if (!word) return false;

  switch (rule.checkKind) {
    case 'minLength':
      return atLeast(word.length, rule.checkValue);
    case 'minVowels':
      return atLeast((word.match(VOWELS) || []).length, rule.checkValue);
    case 'adjacentVowels':
      return /[aeiou]{2}/i.test(word);
    case 'doubleLetter': {
      // A named letter matters: a rule reading "must contain 'ss'" is not
      // satisfied by "Sunny", so the value narrows the check when it is given.
      const named = rule.checkValue.trim().toLowerCase();
      if (!named) return /([a-z])\1/i.test(word);
      const pair = named.length === 1 ? named + named : named;
      return word.toLowerCase().includes(pair);
    }
    case 'endsWithVowel':
      return ENDS_IN_VOWEL.test(word);
    case 'endsWith': {
      // "Ends in a vowel" is its own kind, but it reached the store as an
      // endsWith rule before that kind existed, so it is still read here.
      if (namesAVowel(rule.checkValue)) return ENDS_IN_VOWEL.test(word);

      // Handed back rather than refused: no word ends in a space, so treating a
      // blank ending as a real rule would make the bonus unwinnable all day.
      const endings = endingsOf(rule.checkValue);
      if (endings.length === 0) return null;

      const lower = word.toLowerCase();
      return endings.some((ending) => lower.endsWith(ending));
    }
    default:
      return null;
  }
}

/**
 * Settles the bonus for a round: overrules the judge wherever the rule is
 * mechanical, and always applies the rule's own scope.
 *
 * A challenge with no rule is left exactly as it arrived, because challenges
 * generated before rules existed are still served from the store.
 */
export function enforceBonusRule(
  verdict: JudgeVerdict,
  answers: Record<CategoryKey, string>,
  challenge: BonusChallenge | undefined
): JudgeVerdict {
  const rule = challenge?.rule;
  if (!rule) return verdict;

  const categories = { ...verdict.categories };
  const scopedToOne = rule.scope !== 'all' && rule.scope !== 'some';

  for (const key of CATEGORY_KEYS) {
    const judged = categories[key];

    // A rule naming one category says nothing about the other three, so neither
    // the check nor the judge may award them the bonus.
    const inScope = !scopedToOne || rule.scope === key;
    const decided = inScope ? satisfiesCheck(rule, answers[key]) : false;

    // An answer that is not valid never earns the bonus, whichever way the rule
    // was settled.
    const matched = (decided ?? judged.bonusMatched) && judged.valid;
    if (matched !== judged.bonusMatched) {
      categories[key] = { ...judged, bonusMatched: matched };
    }
  }

  const matchedKeys = CATEGORY_KEYS.filter((key) => categories[key].bonusMatched);

  return { ...verdict, categories, bonusChallengeMet: bonusMetFor(rule.scope, matchedKeys) };
}
