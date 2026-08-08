import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import {
  BONUS_SYSTEM_PROMPT,
  RENDERABLE_ICONS,
  buildBonusSchema,
  buildBonusUserPrompt,
  createAzureBonusSource,
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
