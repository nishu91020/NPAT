import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { ModelRefusedError, TruncatedCompletionError } from '../azure/structuredCompletion';
import {
  BONUS_SYSTEM_PROMPT,
  RENDERABLE_ICONS,
  RULE_FAMILIES,
  buildBonusSchema,
  buildBonusUserPrompt,
  createAzureBonusSource,
  createRecentAvoidingPicker,
  pickRuleFamily,
  restatesTargetLetter,
  ruleFamilyForDate,
  toBonusRule,
} from './azureSource';

const DEPLOYMENT = 'npat-bonus';

const complete = {
  id: 'space_twist_S',
  title: 'Stellar Explorer',
  description: 'At least 2 answers must relate to space.',
  icon: 'Globe',
  ruleHint: 'Space themed.',
  rule: { scope: 'some', checkKind: 'none', checkValue: '' },
};

function fakeClient(content: string) {
  const create = vi.fn(async (_args: any) => ({
    choices: [{ message: { content }, finish_reason: 'stop' }],
  }));
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
}

describe('buildBonusSchema', () => {
  const schema = buildBonusSchema() as any;

  it('sets additionalProperties false, as strict mode requires', () => {
    expect(schema.additionalProperties).toBe(false);
  });

  it('lists every property as required, as strict mode requires', () => {
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
  });

  it('constrains the icon to what the UI can render', () => {
    expect(schema.properties.icon.enum).toEqual([...RENDERABLE_ICONS]);
  });

  it('offers no icon the UI would fall back on', () => {
    for (const icon of ['Compass', 'Zap', 'Feather']) {
      expect(schema.properties.icon.enum).not.toContain(icon);
    }
  });

  it('expresses no maxLength, which strict mode does not support', () => {
    expect(JSON.stringify(schema)).not.toContain('maxLength');
  });
});

describe('prompt split', () => {
  it('keeps the fixed instructions out of the per-request message', () => {
    expect(BONUS_SYSTEM_PROMPT).toContain('expert game designer');
    expect(buildBonusUserPrompt('S')).not.toContain('expert game designer');
  });

  it('states the length limits in the prompt, since the schema cannot', () => {
    expect(BONUS_SYSTEM_PROMPT).toContain('maximum 25 characters');
    expect(BONUS_SYSTEM_PROMPT).toContain('maximum 85 characters');
  });

  it('uppercases the target letter', () => {
    expect(buildBonusUserPrompt('s')).toContain('"S"');
  });

  it('rules out challenges a category could never satisfy', () => {
    // Observed live: "Use only plants or flowers for all answers" — impossible,
    // since a Name is a person and an Animal is a creature.
    expect(BONUS_SYSTEM_PROMPT).toContain('IS IT POSSIBLE');
    expect(BONUS_SYSTEM_PROMPT).toContain('All answers must be plants');
  });

  it('rules out challenges that merely restate the target letter', () => {
    // Observed live after the first fix: "Every answer must start with F",
    // which every valid answer earns for free.
    expect(BONUS_SYSTEM_PROMPT).toContain('IS IT ACTUALLY EXTRA');
    expect(BONUS_SYSTEM_PROMPT).toContain('Every answer must start with F');
  });

  it('forbids smuggling the target letter back in as a qualifier', () => {
    // Observed live: "The Place must be a capital city starting with S", which
    // passes TEST 2 on its face while re-adding the letter rule at the end.
    expect(BONUS_SYSTEM_PROMPT).toContain('MUST NOT MENTION THE TARGET LETTER');
  });

  it('forbids alliterating every title on the target letter', () => {
    // Twelve live generations for S gave "Stretchy S Words", "Space Seekers",
    // "Seafood Savor", "Sporty Squad" — the source of the sameness complaint.
    expect(BONUS_SYSTEM_PROMPT).toContain('NOT ALLITERATION');
  });
});

describe('rule families', () => {
  it('names a family in the per-request message', () => {
    const prompt = buildBonusUserPrompt('S', 'a rule about word length');

    expect(prompt).toContain('a rule about word length');
  });

  it('picks a family from the list', () => {
    expect(RULE_FAMILIES).toContain(pickRuleFamily(() => 0));
    expect(RULE_FAMILIES).toContain(pickRuleFamily(() => 0.999));
  });

  it('spans word shape, themes and single categories, so rounds vary', () => {
    const all = RULE_FAMILIES.join(' ');

    expect(all).toContain('word length');
    expect(all).toContain('shared theme');
    expect(all).toContain('only the Thing');
  });

  it('never selects out of range', () => {
    for (const r of [0, 0.5, 0.9999]) {
      expect(pickRuleFamily(() => r)).toBeDefined();
    }
  });

  it('offers enough distinct families that a month of play does not repeat', () => {
    // The model writes near-identical rules within a family, so the family
    // count is the real ceiling on variety, not the number of rounds.
    expect(new Set(RULE_FAMILIES).size).toBe(RULE_FAMILIES.length);
    expect(RULE_FAMILIES.length).toBeGreaterThanOrEqual(31);
  });

  it('names each theme concretely rather than as one broad bucket', () => {
    const themes = RULE_FAMILIES.filter((f) => f.includes('shared theme'));

    expect(themes.length).toBeGreaterThanOrEqual(10);
  });
});

describe('ruleFamilyForDate', () => {
  const dateOffsetBy = (days: number) =>
    new Date(Date.UTC(2026, 0, 1) + days * 86_400_000).toISOString().split('T')[0];

  it('is deterministic for a date', () => {
    expect(ruleFamilyForDate('2026-08-10')).toBe(ruleFamilyForDate('2026-08-10'));
  });

  it('never repeats a family on consecutive days', () => {
    for (let day = 0; day < 400; day++) {
      expect(ruleFamilyForDate(dateOffsetBy(day))).not.toBe(
        ruleFamilyForDate(dateOffsetBy(day + 1))
      );
    }
  });

  it('walks every family before repeating one', () => {
    const cycle = Array.from({ length: RULE_FAMILIES.length }, (_, day) =>
      ruleFamilyForDate(dateOffsetBy(day))
    );

    expect(new Set(cycle).size).toBe(RULE_FAMILIES.length);
  });

  it('handles dates before the Unix epoch without indexing off the front', () => {
    expect(RULE_FAMILIES).toContain(ruleFamilyForDate('1960-03-04'));
  });

  it('falls back to a random family for an unparseable date', () => {
    expect(RULE_FAMILIES).toContain(ruleFamilyForDate('practice'));
  });
});

describe('createRecentAvoidingPicker', () => {
  it('does not repeat a recently used family', () => {
    // Always drawing index 0 of the eligible pool: without the memory this
    // would return the same family forever.
    const pick = createRecentAvoidingPicker(5, () => 0);
    const picks = [pick(), pick(), pick(), pick(), pick()];

    expect(new Set(picks).size).toBe(5);
  });

  it('keeps producing families once the memory is full', () => {
    const pick = createRecentAvoidingPicker(3, () => 0);

    for (let i = 0; i < 50; i++) expect(RULE_FAMILIES).toContain(pick());
  });

  it('never lets the memory swallow the whole pool', () => {
    const pick = createRecentAvoidingPicker(RULE_FAMILIES.length * 2, () => 0);

    for (let i = 0; i < RULE_FAMILIES.length + 5; i++) {
      expect(RULE_FAMILIES).toContain(pick());
    }
  });
});

describe('createAzureBonusSource', () => {
  it('calls the deployment name as the model', async () => {
    const { client, create } = fakeClient(JSON.stringify(complete));

    await createAzureBonusSource(client, DEPLOYMENT).next('S');

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: DEPLOYMENT }));
  });

  it('asks for strict structured output at a creative temperature', async () => {
    const { client, create } = fakeClient(JSON.stringify(complete));

    await createAzureBonusSource(client, DEPLOYMENT).next('S');

    const args = create.mock.calls[0][0] as any;
    expect(args.response_format.json_schema.strict).toBe(true);
    expect(args.temperature).toBe(0.8);
  });

  it('asks the injected picker for the family, once per generation', async () => {
    // How variety is achieved is the caller's decision: the daily challenge
    // rotates by date, practice avoids recent repeats.
    const { client, create } = fakeClient(JSON.stringify(complete));
    const pickFamily = vi.fn(() => 'a rule about word length, invented for this test');

    const source = createAzureBonusSource(client, DEPLOYMENT, pickFamily);
    await source.next('S');
    await source.next('S');

    expect(pickFamily).toHaveBeenCalledTimes(2);
    const args = create.mock.calls[0][0] as any;
    expect(args.messages[1].content).toContain('invented for this test');
  });

  it('passes through a well-formed challenge', async () => {
    const { client } = fakeClient(JSON.stringify(complete));

    await expect(createAzureBonusSource(client, DEPLOYMENT).next('S')).resolves.toEqual(complete);
  });

  it('clamps an unrenderable icon to Sparkles', async () => {
    const { client } = fakeClient(JSON.stringify({ ...complete, icon: 'Compass' }));

    const challenge = await createAzureBonusSource(client, DEPLOYMENT).next('S');

    expect(challenge.icon).toBe('Sparkles');
  });

  it('falls back to the title when ruleHint is missing', async () => {
    const { ruleHint, ...withoutHint } = complete;
    const { client } = fakeClient(JSON.stringify(withoutHint));

    const challenge = await createAzureBonusSource(client, DEPLOYMENT).next('S');

    expect(challenge.ruleHint).toBe(complete.title);
  });

  it('throws on an incomplete challenge so the fallback engages', async () => {
    const { client } = fakeClient(JSON.stringify({ id: 'x' }));

    await expect(createAzureBonusSource(client, DEPLOYMENT).next('S')).rejects.toThrow();
  });

  it('throws on empty content so the fallback engages', async () => {
    const create = vi.fn(async () => ({ choices: [{ message: { content: null } }] }));
    const client = { chat: { completions: { create } } } as unknown as OpenAI;

    await expect(createAzureBonusSource(client, DEPLOYMENT).next('S')).rejects.toThrow(/empty/);
  });

  it('throws on unparseable output so the fallback engages', async () => {
    const { client } = fakeClient('not json');

    await expect(createAzureBonusSource(client, DEPLOYMENT).next('S')).rejects.toThrow();
  });
});

/**
 * These paths were unhandled before the completer was extracted: this adapter
 * parsed the raw content itself, so a refusal or a truncated response surfaced
 * as a bare JSON syntax error with nothing naming the real cause.
 */
describe('failures inherited from the completer', () => {
  it('names a truncated response instead of reporting a syntax error', async () => {
    const create = vi.fn(async () => ({
      choices: [{ message: { content: '{"id":"space_twist_S","tit' }, finish_reason: 'length' }],
    }));
    const client = { chat: { completions: { create } } } as unknown as OpenAI;

    await expect(createAzureBonusSource(client, DEPLOYMENT).next('S')).rejects.toThrow(
      TruncatedCompletionError
    );
  });

  it('names a refusal instead of reporting empty content', async () => {
    const create = vi.fn(async () => ({
      choices: [{ message: { content: null, refusal: 'I cannot help with that' } }],
    }));
    const client = { chat: { completions: { create } } } as unknown as OpenAI;

    await expect(createAzureBonusSource(client, DEPLOYMENT).next('S')).rejects.toThrow(
      ModelRefusedError
    );
  });

  it('surfaces a content-filter rejection with its harm categories', async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error('content_filter'), {
        status: 400,
        code: 'content_filter',
        error: { innererror: { content_filter_result: { violence: { filtered: true } } } },
      });
    });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;

    await expect(
      createAzureBonusSource(client, DEPLOYMENT).next('S')
    ).rejects.toMatchObject({ harmCategories: ['violence'] });
  });
});

/**
 * The rule is what the referee acts on, so a wrong one silently misjudges every
 * round it appears in. Degrading to "ask the judge" is the safe direction.
 */
describe('toBonusRule', () => {
  it('keeps a well-formed mechanical rule', () => {
    expect(toBonusRule({ scope: 'all', checkKind: 'adjacentVowels', checkValue: '' })).toEqual({
      scope: 'all',
      checkKind: 'adjacentVowels',
      checkValue: '',
    });
  });

  it('keeps a single-category scope, which is what makes such a challenge winnable', () => {
    expect(toBonusRule({ scope: 'thing', checkKind: 'none', checkValue: '' }).scope).toBe('thing');
  });

  it('falls back to a judged rule when the kind is unknown', () => {
    expect(toBonusRule({ scope: 'all', checkKind: 'rhymesWith', checkValue: 'oon' })).toEqual({
      scope: 'all',
      checkKind: 'none',
      checkValue: '',
    });
  });

  it('falls back when a counting rule carries no number', () => {
    expect(toBonusRule({ scope: 'all', checkKind: 'minLength', checkValue: 'five' }).checkKind).toBe(
      'none'
    );
  });

  it('falls back when endsWith carries no ending', () => {
    expect(toBonusRule({ scope: 'all', checkKind: 'endsWith', checkValue: '' }).checkKind).toBe(
      'none'
    );
  });

  it('falls back to the historical scope when the scope is unknown', () => {
    expect(toBonusRule({ scope: 'everyone', checkKind: 'none', checkValue: '' }).scope).toBe('some');
  });

  it('survives the field being missing entirely', () => {
    expect(toBonusRule(undefined)).toEqual({ scope: 'some', checkKind: 'none', checkValue: '' });
  });
});

/**
 * Number('') is 0 and finite, so an empty threshold used to survive clamping and
 * make the bonus free for every answer, for the whole day the challenge is stored.
 */
describe('toBonusRule numeric thresholds', () => {
  it.each(['', '  ', '0', '-2'])('falls back when the threshold is %j', (value) => {
    expect(toBonusRule({ scope: 'all', checkKind: 'minLength', checkValue: value }).checkKind).toBe(
      'none'
    );
    expect(toBonusRule({ scope: 'all', checkKind: 'minVowels', checkValue: value }).checkKind).toBe(
      'none'
    );
  });

  it('keeps a real threshold', () => {
    expect(toBonusRule({ scope: 'all', checkKind: 'minLength', checkValue: '5' })).toEqual({
      scope: 'all',
      checkKind: 'minLength',
      checkValue: '5',
    });
  });
});

describe('toBonusRule rejects rules no answer could satisfy', () => {
  it.each([' ', '   '])('degrades a blank endsWith value (%j)', (value) => {
    expect(toBonusRule({ scope: 'all', checkKind: 'endsWith', checkValue: value }).checkKind).toBe('none');
  });

  it('degrades an unreachable threshold', () => {
    expect(
      toBonusRule({ scope: 'all', checkKind: 'minLength', checkValue: 'Infinity' }).checkKind
    ).toBe('none');
  });

  it('keeps a real ending', () => {
    expect(toBonusRule({ scope: 'all', checkKind: 'endsWith', checkValue: 'e' }).checkValue).toBe('e');
  });

  it('rescues "ends in a vowel" as its own kind rather than dropping the check', () => {
    // Observed live: the rule arrived as an endsWith value no word can end with,
    // so "Vase" missed the bonus under a rule it satisfied.
    const rule = toBonusRule({ scope: 'thing', checkKind: 'endsWith', checkValue: 'a vowel' });

    expect(rule.checkKind).toBe('endsWithVowel');
    expect(rule.checkValue).toBe('');
    expect(rule.scope).toBe('thing');
  });

  it('accepts the vowel kind and strips the value it takes no use for', () => {
    expect(
      toBonusRule({ scope: 'all', checkKind: 'endsWithVowel', checkValue: 'aeiou' })
    ).toEqual({ scope: 'all', checkKind: 'endsWithVowel', checkValue: '' });
  });

  it('keeps a list of endings, which the referee reads as alternatives', () => {
    expect(
      toBonusRule({ scope: 'all', checkKind: 'endsWith', checkValue: 'ly or ing' }).checkKind
    ).toBe('endsWith');
  });

  it('degrades an ending that names no letters at all', () => {
    expect(
      toBonusRule({ scope: 'all', checkKind: 'endsWith', checkValue: '!!' }).checkKind
    ).toBe('none');
  });
});

describe('restatesTargetLetter', () => {
  it('catches the qualifier that was observed live', () => {
    // "The Place must be a capital city starting with S" passes the "actually
    // extra" test on its face while re-adding the letter rule at the end.
    expect(restatesTargetLetter('The Place must be a capital city starting with S', 'S')).toBe(
      true
    );
  });

  it('catches the phrasings a model reaches for', () => {
    for (const description of [
      'Every answer must start with F',
      'All answers must begin with the letter S',
      "Each answer should start with an 'S'",
      'Answers beginning with S only.',
    ]) {
      expect(restatesTargetLetter(description, description.includes('F') ? 'F' : 'S')).toBe(true);
    }
  });

  it('leaves a rule about how words END alone', () => {
    // A genuinely different rule: valid answers do not earn it for free.
    expect(restatesTargetLetter('Every answer must end with S', 'S')).toBe(false);
  });

  it('does not fire on a description that merely contains the letter', () => {
    expect(restatesTargetLetter('The Place must be a capital city.', 'S')).toBe(false);
    expect(restatesTargetLetter('At least 2 answers must relate to the sea.', 'S')).toBe(false);
  });

  it('does not fire on a word that merely begins with the letter', () => {
    // "starting with Spain" is a phrase about a place, not the letter rule.
    expect(restatesTargetLetter('At least 2 answers must relate to Spain.', 'S')).toBe(false);
    expect(restatesTargetLetter('A journey starting with Spain counts.', 'S')).toBe(false);
  });

  it('is inert without a letter', () => {
    expect(restatesTargetLetter('Every answer must start with S', '')).toBe(false);
  });
});

describe('createAzureBonusSource rejects a challenge that restates the letter', () => {
  it('throws, so withBonusFallback replaces it rather than serving it all day', async () => {
    const { client } = fakeClient(
      JSON.stringify({
        ...complete,
        description: 'The Place must be a capital city starting with S.',
      })
    );

    await expect(createAzureBonusSource(client, DEPLOYMENT).next('S')).rejects.toThrow(
      /restated the target letter/
    );
  });

  it('passes a compliant challenge through', async () => {
    const { client } = fakeClient(JSON.stringify(complete));

    await expect(createAzureBonusSource(client, DEPLOYMENT).next('S')).resolves.toMatchObject({
      description: complete.description,
    });
  });
});
