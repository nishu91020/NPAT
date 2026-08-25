import type OpenAI from 'openai';
import { BonusChallenge, BonusRule, CategoryKey } from '../../shared/contract';
import { createStructuredCompleter } from '../azure/jsonSchemaCompleter';
import { endingsOf, satisfiesCheck, startsWithTargetLetter } from '../referee/roundGuardrails';
import { CATEGORY_KEYS, bonusMetFor } from '../referee/rules';
import { BonusChallengeSource } from './dailyChallenge';
import { RENDERABLE_ICONS } from './icons';
import { RULE_FAMILIES } from './ruleFamilies';
import { BONUS_SYSTEM_PROMPT } from '../prompts';

export { BONUS_SYSTEM_PROMPT } from '../prompts';
export { RULE_FAMILIES } from './ruleFamilies';

export const BONUS_CHECK_KINDS = [
  'none',
  'minLength',
  'minVowels',
  'adjacentVowels',
  'doubleLetter',
  'endsWith',
  'endsWithVowel',
] as const;

const BONUS_SCOPES = ['all', 'some', 'name', 'place', 'animal', 'thing'] as const;

export function buildBonusSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      icon: { type: 'string', enum: [...RENDERABLE_ICONS] },
      ruleHint: { type: 'string' },

      rule: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scope: { type: 'string', enum: ['all', 'some', 'name', 'place', 'animal', 'thing'] },
          checkKind: { type: 'string', enum: [...BONUS_CHECK_KINDS] },
          checkValue: { type: 'string' },
        },
        required: ['scope', 'checkKind', 'checkValue'],
      },

      examples: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          place: { type: 'string' },
          animal: { type: 'string' },
          thing: { type: 'string' },
        },
        required: ['name', 'place', 'animal', 'thing'],
      },
    },
    required: ['id', 'title', 'description', 'icon', 'ruleHint', 'rule', 'examples'],
  };
}


export function pickRuleFamily(random: () => number = Math.random): string {
  return RULE_FAMILIES[Math.floor(random() * RULE_FAMILIES.length)];
}

export function restatesTargetLetter(description: string, letter: string): boolean {
  const target = (letter || '').trim().charAt(0);
  if (!target) return false;

  const pattern = new RegExp(
    `\\b(?:start|starts|starting|begin|begins|beginning)\\s+with\\s+` +
      `(?:(?:a|an|the)\\s+)?(?:letters?\\s+)?["'“”‘’]?${target}(?![a-z])`,
    'i'
  );

  return pattern.test(description || '');
}

const DAILY_FAMILY_STRIDE = 17;

function dayOrdinal(dateStr: string): number {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : NaN;
}

export function ruleFamilyForDate(dateStr: string): string {
  const ordinal = dayOrdinal(dateStr);
  if (!Number.isFinite(ordinal)) return pickRuleFamily();

  const n = RULE_FAMILIES.length;

  const index = (((ordinal * DAILY_FAMILY_STRIDE) % n) + n) % n;
  return RULE_FAMILIES[index];
}

export function createRecentAvoidingPicker(
  memory = 8,
  random: () => number = Math.random
): () => string {
  const recent: string[] = [];

  const limit = Math.max(0, Math.min(memory, RULE_FAMILIES.length - 1));

  return () => {
    const eligible = RULE_FAMILIES.filter((f) => !recent.includes(f));
    const pool = eligible.length > 0 ? eligible : [...RULE_FAMILIES];
    const choice = pool[Math.floor(random() * pool.length)] ?? pool[0];

    recent.push(choice);
    while (recent.length > limit) recent.shift();

    return choice;
  };
}

export function buildBonusUserPrompt(letter: string, ruleFamily = pickRuleFamily()): string {
  return `Target letter: "${letter.toUpperCase()}".
For this round, write ${ruleFamily}.`;
}

type BonusExamplesInput =
  | Partial<Record<CategoryKey, string | number | null | undefined>>
  | null
  | undefined;

type BonusRuleInput = {
  scope?: string;
  checkKind?: string;
  checkValue?: string | number;
};

export function examplesProveChallenge(
  examples: BonusExamplesInput,
  letter: string,
  rule: BonusRule
): boolean {
  const given = examples ?? {};

  const words = {} as Record<CategoryKey, string>;
  for (const key of CATEGORY_KEYS) {
    const rawValue = given[key];
    const word = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (typeof rawValue !== 'string' || !startsWithTargetLetter(word, letter)) return false;
    words[key] = word;
  }

  const satisfied = CATEGORY_KEYS.filter((key) => satisfiesCheck(rule, words[key]) !== false);

  return bonusMetFor(rule.scope, satisfied);
}

export class UnfitChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnfitChallengeError';
  }
}

export function createAzureBonusSource(
  client: OpenAI,
  deployment: string,
  pickFamily: () => string = pickRuleFamily
): BonusChallengeSource {
  const completer = createStructuredCompleter(client, deployment);

  async function generate(letter: string): Promise<BonusChallenge> {

    const parsed = await completer.complete<any>({
      system: BONUS_SYSTEM_PROMPT,
      user: buildBonusUserPrompt(letter, pickFamily()),
      schemaName: 'bonus_challenge',
      schema: buildBonusSchema(),
      temperature: 0.8,
    });

    if (!parsed.title || !parsed.description) {
      throw new Error('Azure bonus source returned an incomplete challenge');
    }

    if (restatesTargetLetter(parsed.description, letter)) {
      throw new UnfitChallengeError(
        `Azure bonus source restated the target letter: "${parsed.description}"`
      );
    }

    const icon = RENDERABLE_ICONS.includes(parsed.icon) ? parsed.icon : 'Sparkles';
    const rule = toBonusRule(parsed.rule);

    if (!examplesProveChallenge(parsed.examples, letter, rule)) {
      throw new UnfitChallengeError(
        `Azure bonus source could not demonstrate "${parsed.description}" for letter ` +
          `"${letter.toUpperCase()}": ${JSON.stringify(parsed.examples)}`
      );
    }

    return {
      id: parsed.id || `azure_${letter.toUpperCase()}_${Date.now()}`,
      title: parsed.title,
      description: parsed.description,
      icon,
      ruleHint: parsed.ruleHint || parsed.title,
      rule,
    };
  }

  return {
    async next(letter: string): Promise<BonusChallenge> {
      try {
        return await generate(letter);
      } catch (err) {

        if (!(err instanceof UnfitChallengeError)) throw err;

        console.warn(`${err.message} — generating a replacement.`);
        return generate(letter);
      }
    },
  };
}

export function toBonusRule(raw: BonusRuleInput | null | undefined): BonusRule {
  const candidate: BonusRuleInput = raw ?? {};

  const scopeValue = typeof candidate.scope === 'string' ? candidate.scope : '';
  const scope = BONUS_SCOPES.includes(scopeValue as (typeof BONUS_SCOPES)[number])
    ? (scopeValue as (typeof BONUS_SCOPES)[number])
    : 'some';

  const checkKindValue = typeof candidate.checkKind === 'string' ? candidate.checkKind : '';
  const checkKind = BONUS_CHECK_KINDS.includes(
    checkKindValue as (typeof BONUS_CHECK_KINDS)[number]
  )
    ? (checkKindValue as (typeof BONUS_CHECK_KINDS)[number])
    : 'none';

  const checkValue = typeof candidate.checkValue === 'string' ? candidate.checkValue : '';

  const judged: BonusRule = { scope, checkKind: 'none', checkValue: '' };
  if (checkKind === 'none') return judged;

  const needsNumber = checkKind === 'minLength' || checkKind === 'minVowels';
  const threshold = Number(checkValue.trim() || NaN);
  if (needsNumber && (!Number.isFinite(threshold) || threshold < 1)) return judged;

  if (checkKind === 'endsWith' && endingsOf(checkValue).length === 0) {
    return /vowel/i.test(checkValue)
      ? { scope, checkKind: 'endsWithVowel', checkValue: '' }
      : judged;
  }

  if (checkKind === 'endsWithVowel') return { scope, checkKind, checkValue: '' };

  return { scope, checkKind, checkValue };
}
