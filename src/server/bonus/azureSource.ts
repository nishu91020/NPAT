import type OpenAI from 'openai';
import { BonusChallenge, BonusRule } from '../../shared/contract';
import { createStructuredCompleter } from '../azure/structuredCompletion';
import { endingsOf } from '../referee/bonusRule';
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
  'endsWithVowel',
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
    - "endsWith" with checkValue as the ending, e.g. "e". ONE literal ending, never a list and
      never a description — "a vowel" and "a, e, i, o, u" are not endings any word has.
    - "endsWithVowel" with checkValue "", for a word ending in a, e, i, o or u. This is the ONLY
      way to write "must end in a vowel"; never express it as "endsWith".
    - "none" with checkValue "" when the rule needs real-world knowledge — a theme, a famous
      person, whether something is edible. Use "none" whenever no other kind fits exactly.
  - Never use a checkKind that does not match the description precisely. If the description says
    two vowels side by side, the kind is "adjacentVowels", not "minVowels".

WHEN YOUR RULE IS ABOUT THE LETTERS IN THE WORDS, CHOOSE THE CHECK FIRST, THEN DESCRIBE IT.
Pick exactly one checkKind from the list above and write the description to say precisely that and
nothing more. Never join two conditions with "or" — "a double s or two vowels side by side" cannot
be checked, so the game has to fall back to guessing and the same answer scores differently on
different days. One rule, one check, stated once.

THE RULE MUST NOT MENTION THE TARGET LETTER AT ALL. It has to read identically whatever the letter
of the day is. "The Place must be a capital city starting with S" fails TEST 2 by smuggling the
letter back in as an extra qualifier, and "All answers must end with the letter S" is the same
trick from the other end. Write "The Place must be a capital city." If your description would stop
making sense with the letter removed, the rule is wrong.

WRITE A TITLE THAT IS NOT ALLITERATION. Players see one of these a day, and titles that all begin
with the target letter — "Stretchy S Words", "Space Seekers", "Sporty Squad" — read like the same
challenge every time. Never repeat the target letter as a stylistic device in the title. Name the
IDEA of the rule instead: "Long Haul", "Capital Gains", "Wings Required", "Kitchen Business".

VARY THE SENTENCE. Do not reach for one stock construction. "At least 2 answers must relate to X"
for every theme reads like a template, and it is. Say what the rule is in the most natural words
for that particular rule, while keeping it exact.`;

/**
 * Families of rule, one picked per request.
 *
 * Left to itself the model anchors hard on whichever example it saw first —
 * six consecutive generations all came back as "every answer must end with X".
 * Naming the family explicitly buys variety that temperature alone does not.
 *
 * The list is long and each entry is *specific* on purpose. A short list of
 * broad families ("a rule about a shared theme") is barely better than none:
 * the model writes near-identical output within a family, so the effective
 * number of distinct challenges is the number of families, not the number of
 * rounds. Twelve generations against the old thirteen-entry list produced two
 * challenges that differed only in a threshold, and five phrased identically.
 */
export const RULE_FAMILIES = [
  // Word shape — the checkable kinds. Spread across scopes so it is not always
  // "all four answers must be N letters long".
  'a rule about word length, requiring every answer to reach a minimum number of letters',
  'a rule about word length that constrains only ONE named category, such as requiring a long Thing',
  'a rule requiring every answer to contain a minimum number of vowels',
  'a rule requiring two vowels side by side in every answer, such as "ea" or "oo"',
  'a rule requiring a double letter — the same letter twice in a row — in every answer',
  'a rule about how the words end, requiring every answer to end in a vowel',
  'a rule about how the words end, requiring one named category to end in a vowel',
  'a rule about a specific word ending, such as every answer ending in the same consonant (never the target letter)',

  // Shared themes, named concretely. "a shared theme" alone always came back as
  // "at least 2 answers must relate to X".
  'a rule about a shared theme of the sea, rivers or water',
  'a rule about a shared theme of weather, the sky or the seasons',
  'a rule about a shared theme of forests, plants or the wild',
  'a rule about a shared theme of food, drink or cooking',
  'a rule about a shared theme of travel, geography or famous landmarks',
  'a rule about a shared theme of space, stars or astronomy',
  'a rule about a shared theme of science, invention or technology',
  'a rule about a shared theme of history or the ancient world',
  'a rule about a shared theme of myth, legend or folklore',
  'a rule about a shared theme of music or dance',
  'a rule about a shared theme of art, books, film or television',
  'a rule about a shared theme of sport, games or competition',
  'a rule about a shared theme of colours',
  'a rule about a shared theme of kings, queens, leaders or power',
  'a rule about a shared theme of speed, flight or movement',
  'a rule about a shared theme of ice, cold or winter',
  'a rule about a shared theme of fire, heat or the desert',
  'a rule about a shared theme of money, trade or work',
  'a rule about a shared theme of school, learning or books',
  'a rule about a shared theme of India or South Asia',
  'a rule about a shared theme of things that are very large, or of things that are very small',
  'a rule about a shared theme of the human body or health',
  'a rule about a shared theme of danger, mystery or the frightening',

  // Single-category constraints, one per plausible angle.
  'a rule constraining only the Name, requiring a famous or historical person',
  'a rule constraining only the Name, requiring a character from a book, film or myth',
  'a rule constraining only the Name, requiring a name commonly given to more than one gender or used worldwide',
  'a rule constraining only the Place, requiring a capital city',
  'a rule constraining only the Place, requiring a natural feature such as a river, mountain, lake or desert',
  'a rule constraining only the Place, requiring an island, an ocean or somewhere on the coast',
  'a rule constraining only the Place, requiring somewhere outside the country the player is likely in',
  'a rule constraining only the Animal, requiring one that can fly',
  'a rule constraining only the Animal, requiring one that lives in water',
  'a rule constraining only the Animal, requiring a bird, or requiring an insect',
  'a rule constraining only the Animal, requiring a wild predator rather than a pet or farm animal',
  'a rule constraining only the Thing, requiring something edible or drinkable',
  'a rule constraining only the Thing, requiring something found in a kitchen',
  'a rule constraining only the Thing, requiring something you can wear',
  'a rule constraining only the Thing, requiring something that carries people or moves',
  'a rule constraining only the Thing, requiring something found in a classroom or an office',
  'a rule constraining only the Thing, requiring something that makes a sound',
  'a rule constraining only the Thing, requiring something small enough to hold in one hand',
] as const;

export function pickRuleFamily(random: () => number = Math.random): string {
  return RULE_FAMILIES[Math.floor(random() * RULE_FAMILIES.length)];
}

/**
 * Step between consecutive days in the daily rotation.
 *
 * Any value coprime with RULE_FAMILIES.length walks the whole list before
 * repeating any entry, so a full cycle is guaranteed; a stride of 1 would do
 * that too but would march the themes through in written order, which reads as
 * "sea, then weather, then forests" — a pattern a daily player would notice.
 * A test pins both the full cycle and that no two consecutive days match.
 */
const DAILY_FAMILY_STRIDE = 17;

/** Days since the Unix epoch for a YYYY-MM-DD string, or NaN if unparseable. */
function dayOrdinal(dateStr: string): number {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : NaN;
}

/**
 * The rule family for a date — deterministic, and never the same two days
 * running.
 *
 * Picking at random per request meant consecutive days could draw the same
 * family, which is exactly the repetition a once-a-day game cannot hide. The
 * daily challenge is generated once per date anyway, so the family may as well
 * be a function of that date.
 */
export function ruleFamilyForDate(dateStr: string): string {
  const ordinal = dayOrdinal(dateStr);
  if (!Number.isFinite(ordinal)) return pickRuleFamily();

  const n = RULE_FAMILIES.length;
  // Positive modulo: dates before 1970 would otherwise index off the front.
  const index = (((ordinal * DAILY_FAMILY_STRIDE) % n) + n) % n;
  return RULE_FAMILIES[index];
}

/**
 * A picker that will not repeat any of the last `memory` families.
 *
 * Practice rounds are drawn per request, so a uniform draw hands the player the
 * same family twice in a row often enough to feel broken. Remembering the
 * recent ones costs nothing and removes the case players actually notice.
 */
export function createRecentAvoidingPicker(
  memory = 8,
  random: () => number = Math.random
): () => string {
  const recent: string[] = [];
  // Never let the exclusion list swallow the whole pool, which would loop forever.
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

/**
 * Bonus challenge generator backed by a model deployed on Microsoft Foundry.
 *
 * `deployment` is the deployment name, which is what the API's `model`
 * parameter expects — not the underlying model name.
 *
 * `pickFamily` is injected so callers decide how variety is achieved: the daily
 * challenge rotates deterministically by date, practice avoids recent repeats.
 */
export function createAzureBonusSource(
  client: OpenAI,
  deployment: string,
  pickFamily: () => string = pickRuleFamily
): BonusChallengeSource {
  const completer = createStructuredCompleter(client, deployment);

  return {
    async next(letter: string): Promise<BonusChallenge> {
      // Refusals, truncation and filter rejections are named by the completer.
      // Previously this parsed the raw content itself, so a truncated response
      // surfaced as a bare JSON syntax error.
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

  // An ending the referee cannot read is worse than no check: it would refuse
  // every answer all day. "Ends in a vowel" is the one kind it can recover.
  if (checkKind === 'endsWith' && endingsOf(checkValue).length === 0) {
    return /vowel/i.test(checkValue)
      ? { scope, checkKind: 'endsWithVowel', checkValue: '' }
      : judged;
  }

  if (checkKind === 'endsWithVowel') return { scope, checkKind, checkValue: '' };

  return { scope, checkKind, checkValue };
}
