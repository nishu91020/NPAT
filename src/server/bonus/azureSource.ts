import type OpenAI from 'openai';
import { BonusChallenge, BonusRule } from '../../shared/contract';
import { createStructuredCompleter } from '../azure/structuredCompletion';
import { BonusChallengeSource } from './types';
import { RENDERABLE_ICONS } from './icons';

export { RENDERABLE_ICONS };

/** The checks the game can settle itself. Kept in step with BonusCheckKind. */
export const BONUS_CHECK_KINDS = [
  'none',
  'minLength',
  'minVowels',
  'adjacentVowels',
  'doubleLetter',
  'endsWith',
] as const;

const BONUS_SCOPES = ['all', 'some', 'name', 'place', 'animal', 'thing'] as const;

/**
 * Strict mode cannot express maxLength, so the character limits stay as prompt
 * instructions and the parser stays defensive about what comes back.
 */
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
      // Flat rather than a discriminated union: strict mode handles a fixed
      // object far more reliably than anyOf, and the parser clamps it anyway.
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
    },
    required: ['id', 'title', 'description', 'icon', 'ruleHint', 'rule'],
  };
}

export const BONUS_SYSTEM_PROMPT = `You are an expert game designer for the word puzzle "Name, Place, Animal, Thing".

Generate ONE unique, creative Bonus Challenge rule for the target letter you are given.

THE FOUR CATEGORIES ARE FIXED AND CANNOT CHANGE. Every round has exactly:
- Name — a person's first name or a famous character
- Place — a real city, country, state, river, mountain or landmark
- Animal — a real creature
- Thing — a physical object, tool, food or vehicle

Your rule must pass BOTH of these tests. Check them before you answer.

TEST 1 — IS IT POSSIBLE? A rule is invalid if it asks a category to be something it cannot be.
"All answers must be plants" fails, because a Name is a person and an Animal is a creature — neither
can be a plant. "Every answer must be edible" fails for the same reason. Confirm a real answer exists
for all four categories.

TEST 2 — IS IT ACTUALLY EXTRA? Every answer in this game ALREADY has to start with the target letter.
A bonus that restates that rule is worthless, because every valid answer would earn it for free.
"Every answer must start with F" fails. So does "All answers must begin with the letter S".
Your rule must be something a set of four perfectly valid answers could still FAIL.

Write rules of one of these shapes:
- A property of the words beyond their first letter: "Every answer must contain at least two vowels."
  "Every answer must be at least 7 letters long." "Every answer must end in a vowel."
- A theme at least 2 of the 4 answers can plausibly share: "At least 2 answers must relate to the sea."
  "At least 2 answers must be connected to music."
- A constraint on ONE named category: "The Thing must be something you can eat."
  "The Place must be a capital city." "The Animal must be able to fly."

You will be told which kind of rule to write. Follow it, and make the specific rule your own.

The rule must be decidable by looking at the four words, and must never mention scoring or points.

Constraints on the output:
- id: a short slug string
- title: catchy, maximum 25 characters. A LABEL ONLY — it must never state a rule the description
  does not state. "Double Vowel Delight" above a description about counting vowels anywhere is a
  contradiction: the player reads the title, is judged on the description, and is right to be angry.
- description: a clear rule instruction, maximum 85 characters. It must stand alone and be
  unambiguous. Never use a term like "double vowel" that could mean either two vowels side by side
  or two vowels anywhere — say exactly which you mean.
- icon: one of [${RENDERABLE_ICONS.map((i) => `'${i}'`).join(', ')}]
- ruleHint: ultra concise hint, maximum 35 characters
- rule: the same rule again, in a form the game can check itself. This is not optional and must
  agree with the description exactly.
  - rule.scope — who must satisfy it:
    - "all" when every one of the four answers must satisfy it
    - "some" when a number of answers must (a shared theme)
    - "name", "place", "animal" or "thing" when the rule constrains only that one category
  - rule.checkKind — how the game can verify it without world knowledge:
    - "minLength" with checkValue as a number, e.g. "5" for at least 5 letters
    - "minVowels" with checkValue as a number, counting vowels anywhere in the word
    - "adjacentVowels" with checkValue "", for two vowels side by side such as "ea" or "oo"
    - "doubleLetter" with checkValue "" for the same letter twice in a row such as "ll", or
      checkValue set to a specific pair such as "ss" when the description names that letter
    - "endsWith" with checkValue as the ending, e.g. "e"
    - "none" with checkValue "" when the rule needs real-world knowledge — a theme, a famous
      person, whether something is edible. Use "none" whenever no other kind fits exactly.
  - Never use a checkKind that does not match the description precisely. If the description says
    two vowels side by side, the kind is "adjacentVowels", not "minVowels".

WHEN YOUR RULE IS ABOUT THE LETTERS IN THE WORDS, CHOOSE THE CHECK FIRST, THEN DESCRIBE IT.
Pick exactly one checkKind from the list above and write the description to say precisely that and
nothing more. Never join two conditions with "or" — "a double s or two vowels side by side" cannot
be checked, so the game has to fall back to guessing and the same answer scores differently on
different days. One rule, one check, stated once.`;

/**
 * Families of rule, one picked per request.
 *
 * Left to itself the model anchors hard on whichever example it saw first —
 * six consecutive generations all came back as "every answer must end with X".
 * Naming the family explicitly buys variety that temperature alone does not.
 */
export const RULE_FAMILIES = [
  'a rule about word length, for example a minimum number of letters',
  'a rule about vowels or repeated letters inside the words',
  'a rule about how the words end',
  'a rule about a shared theme such as nature, weather or the sea',
  'a rule about a shared theme such as food, drink or cooking',
  'a rule about a shared theme such as travel, geography or landmarks',
  'a rule about a shared theme such as science, space or technology',
  'a rule about a shared theme such as history, myth or legend',
  'a rule about a shared theme such as music, art or sport',
  'a rule constraining only the Name, such as requiring a famous or historical person',
  'a rule constraining only the Place, such as requiring a capital city or a natural feature',
  'a rule constraining only the Animal, such as requiring one that flies, swims or is wild',
  'a rule constraining only the Thing, such as requiring something edible or something you can hold',
] as const;

export function pickRuleFamily(random: () => number = Math.random): string {
  return RULE_FAMILIES[Math.floor(random() * RULE_FAMILIES.length)];
}

export function buildBonusUserPrompt(letter: string, ruleFamily = pickRuleFamily()): string {
  return `Target letter: "${letter.toUpperCase()}".
For this round, write ${ruleFamily}.`;
}

/**
 * Bonus challenge generator backed by a model deployed on Microsoft Foundry.
 *
 * `deployment` is the deployment name, which is what the API's `model`
 * parameter expects — not the underlying model name.
 */
export function createAzureBonusSource(
  client: OpenAI,
  deployment: string
): BonusChallengeSource {
  const completer = createStructuredCompleter(client, deployment);

  return {
    async next(letter: string): Promise<BonusChallenge> {
      // Refusals, truncation and filter rejections are named by the completer.
      // Previously this parsed the raw content itself, so a truncated response
      // surfaced as a bare JSON syntax error.
      const parsed = await completer.complete<any>({
        system: BONUS_SYSTEM_PROMPT,
        user: buildBonusUserPrompt(letter),
        schemaName: 'bonus_challenge',
        schema: buildBonusSchema(),
        temperature: 0.8,
      });

      if (!parsed.title || !parsed.description) {
        throw new Error('Azure bonus source returned an incomplete challenge');
      }

      // The schema constrains this, but the clamp stays: the UI can only render
      // these seven icons, whatever the model sends.
      const icon = RENDERABLE_ICONS.includes(parsed.icon) ? parsed.icon : 'Sparkles';

      return {
        id: parsed.id || `azure_${letter.toUpperCase()}_${Date.now()}`,
        title: parsed.title,
        description: parsed.description,
        icon,
        ruleHint: parsed.ruleHint || parsed.title,
        rule: toBonusRule(parsed.rule),
      };
    },
  };
}

/**
 * Clamps the machine-checkable rule to something the referee can trust.
 *
 * Anything unrecognised degrades to a judged rule rather than being dropped,
 * because a wrong mechanical check silently misjudges every round it appears in,
 * while "ask the judge" is merely the behaviour that existed before.
 */
export function toBonusRule(raw: unknown): BonusRule {
  const candidate = (raw ?? {}) as Partial<BonusRule>;
  const scope = BONUS_SCOPES.includes(candidate.scope as never) ? candidate.scope! : 'some';
  const checkKind = BONUS_CHECK_KINDS.includes(candidate.checkKind as never)
    ? candidate.checkKind!
    : 'none';
  const checkValue = typeof candidate.checkValue === 'string' ? candidate.checkValue : '';

  const judged: BonusRule = { scope, checkKind: 'none', checkValue: '' };
  if (checkKind === 'none') return judged;

  // A numeric check without a usable threshold would credit every word, so it
  // degrades rather than guessing one. Number('') is 0 and finite, which is why
  // this tests the parsed value rather than just its finiteness.
  const needsNumber = checkKind === 'minLength' || checkKind === 'minVowels';
  const threshold = Number(checkValue.trim() || NaN);
  if (needsNumber && (!Number.isFinite(threshold) || threshold < 1)) return judged;
  if (checkKind === 'endsWith' && !checkValue.trim()) return judged;

  return { scope, checkKind, checkValue };
}
