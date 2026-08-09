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
  pickRuleFamily,
} from './azureSource';

const DEPLOYMENT = 'npat-bonus';

const complete = {
  id: 'space_twist_S',
  title: 'Stellar Explorer',
  description: 'At least 2 answers must relate to space.',
  icon: 'Globe',
  ruleHint: 'Space themed.',
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
