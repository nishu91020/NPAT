import { BonusChallenge, BonusRule, CategoryKey, UserAnswers } from '../../shared/contract';
import { CATEGORY_KEYS, SCORING, bonusMetFor } from './rules';
import { JudgeRequest, JudgeVerdict } from './types';

const VOWELS = /[aeiou]/gi;
const ENDS_IN_VOWEL = /[aeiou]$/i;
const LIST_SEPARATORS = /\s*[,/|]\s*/;
const OR_SEPARATOR = /\s*\bor\b\s*/i;

export function endingsOf(checkValue: string): string[] {
  return (checkValue || '')
    .toLowerCase()
    .split(LIST_SEPARATORS)
    .flatMap((part) => (part.trim() === 'or' ? [part] : part.split(OR_SEPARATOR)))
    .map((ending) => ending.replace(/["'“”‘’`.]/g, '').trim())
    .map((ending) => ending.replace(/^(?:the\s+)?letters?\s+/, ''))
    .filter((ending) => /^[a-z]+$/.test(ending));
}

function namesAVowel(checkValue: string): boolean {
  return /vowel/i.test(checkValue || '');
}

function atLeast(count: number, rawThreshold: string): boolean | null {
  const threshold = Number(rawThreshold.trim() || NaN);

  if (!Number.isFinite(threshold) || threshold < 1) return null;
  return count >= threshold;
}

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
      const named = rule.checkValue.trim().toLowerCase();
      if (!named) return /([a-z])\1/i.test(word);
      const pair = named.length === 1 ? named + named : named;
      return word.toLowerCase().includes(pair);
    }
    case 'endsWithVowel':
      return ENDS_IN_VOWEL.test(word);
    case 'endsWith': {
      if (namesAVowel(rule.checkValue)) return ENDS_IN_VOWEL.test(word);

      const endings = endingsOf(rule.checkValue);
      if (endings.length === 0) return null;

      const lower = word.toLowerCase();
      return endings.some((ending) => lower.endsWith(ending));
    }
    default:
      return null;
  }
}

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

    const inScope = !scopedToOne || rule.scope === key;
    const decided = inScope ? satisfiesCheck(rule, answers[key]) : false;

    const matched = (decided ?? judged.bonusMatched) && judged.valid;
    if (matched !== judged.bonusMatched) {
      categories[key] = { ...judged, bonusMatched: matched };
    }
  }

  const matchedKeys = CATEGORY_KEYS.filter((key) => categories[key].bonusMatched);

  return { ...verdict, categories, bonusChallengeMet: bonusMetFor(rule.scope, matchedKeys) };
}

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

export function targetLetterOf(letter: string): string {
  return (letter || '').trim().charAt(0).toUpperCase();
}

export function startsWithTargetLetter(word: string, letter: string): boolean {
  const trimmed = (word || '').trim();
  return trimmed !== '' && trimmed.charAt(0).toUpperCase() === targetLetterOf(letter);
}

export function withOnlyMatchingLetters(request: JudgeRequest): JudgeRequest {
  const answers = { ...request.answers };

  for (const key of CATEGORY_KEYS) {
    const word = (answers[key] || '').trim();
    answers[key] = startsWithTargetLetter(word, request.letter) ? word : '';
  }

  return { ...request, answers };
}

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
    const feedback = word ? `Must start with the letter "${target}".` : 'No answer provided.';

    if (!judged.valid && !judged.bonusMatched && judged.feedback === feedback) continue;

    corrected = true;
    categories[key] = {
      valid: false,
      bonusMatched: false,
      feedback,
      suggestion: startsWithTargetLetter(judged.suggestion || '', letter)
        ? judged.suggestion
        : undefined,
    };
  }

  if (!corrected) return verdict;

  const bonusMatches = CATEGORY_KEYS.filter((key) => categories[key].bonusMatched).length;

  return {
    ...verdict,
    categories,
    bonusChallengeMet: bonusMatches >= SCORING.bonusChallengeThreshold,
  };
}
