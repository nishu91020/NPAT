import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { BonusChallenge } from '../../shared/contract';
import {
  ADJUDICATOR_SYSTEM_PROMPT,
  buildAdjudicationPrompt,
  buildAdjudicationSchema,
  createAzureBonusAdjudicator,
  toRuling,
} from './azureBonusAdjudicator';
import { BonusAdjudicationRequest, bonusEntriesFor } from './roundBonus';

const colours: BonusChallenge = {
  id: 'colour_theme',
  title: 'Shade Squad',
  description: 'At least 2 answers must relate to a colour.',
  icon: 'Sparkles',
  ruleHint: 'Two answers should relate to a colour.',
  rule: { scope: 'some', checkKind: 'none', checkValue: '' },
};

const request: BonusAdjudicationRequest = {
  letter: 'R',
  bonusChallenge: colours,
  submissions: [
    { name: 'Ruby', place: 'Rome', animal: 'Robin', thing: 'Rose' },
    { name: 'Rachel', place: 'Rome', animal: 'Rat', thing: 'Rug' },
  ],
};

const DEPLOYMENT = 'npat-judge';

function fakeClient(completion: unknown) {
  const create = vi.fn(async (_args: any) => completion);
  return {
    client: { chat: { completions: { create } } } as unknown as OpenAI,
    create,
  };
}

function messageContent(content: string) {
  return { choices: [{ message: { content }, finish_reason: 'stop' }] };
}

describe('buildAdjudicationSchema', () => {
  const schema = buildAdjudicationSchema() as any;

  it('sets additionalProperties false on every object, as strict mode requires', () => {
    const objects: any[] = [];
    const walk = (node: any) => {
      if (node && typeof node === 'object') {
        if (node.type === 'object') objects.push(node);
        Object.values(node).forEach(walk);
      }
    };
    walk(schema);

    expect(objects.length).toBe(2); // root + one ruling
    for (const obj of objects) expect(obj.additionalProperties).toBe(false);
  });

  it('lists every property in required, as strict mode requires', () => {
    const ruling = schema.properties.rulings.items;

    expect(schema.required).toEqual(Object.keys(schema.properties));
    expect(ruling.required).toEqual(Object.keys(ruling.properties));
  });

  it('orders evidence before matched, so reasoning precedes the verdict', () => {
    const props = Object.keys(schema.properties.rulings.items.properties);

    expect(props.indexOf('evidence')).toBeLessThan(props.indexOf('matched'));
  });

  it('constrains the category to the four the game has', () => {
    expect(schema.properties.rulings.items.properties.category.enum).toEqual([
      'name',
      'place',
      'animal',
      'thing',
    ]);
  });
});

describe('ADJUDICATOR_SYSTEM_PROMPT', () => {
  it('tells the model to hold every answer to one reading of the rule', () => {
    expect(ADJUDICATOR_SYSTEM_PROMPT).toMatch(/ONE READING FOR EVERYONE/);
  });

  it('withholds the two rulings that are settled elsewhere', () => {
    expect(ADJUDICATOR_SYSTEM_PROMPT).toMatch(/real member of its category/i);
    expect(ADJUDICATOR_SYSTEM_PROMPT).toMatch(/letter it starts with/i);
  });
});

describe('buildAdjudicationPrompt', () => {
  it('lists every distinct answer of the round, from all players at once', () => {
    const prompt = buildAdjudicationPrompt(request, bonusEntriesFor(request));

    expect(prompt).toContain('thing: "Rose"');
    expect(prompt).toContain('thing: "Rug"');
    expect(prompt).toContain('name: "Ruby"');
    // Both players wrote Rome, and one question is what makes one answer.
    expect(prompt.match(/place: "Rome"/g)).toHaveLength(1);
  });

  it('carries the challenge the round was played under', () => {
    const prompt = buildAdjudicationPrompt(request, bonusEntriesFor(request));

    expect(prompt).toContain('At least 2 answers must relate to a colour.');
    expect(prompt).toContain('Target letter: "R"');
  });
});

describe('toRuling', () => {
  const entries = bonusEntriesFor(request);

  it('reads a ruling back whatever case the model echoed the word in', () => {
    const ruling = toRuling(
      { rulings: [{ category: 'thing', word: 'ROSE', evidence: 'A colour.', matched: true }] },
      entries
    );

    expect(ruling.matched('thing', 'Rose')).toBe(true);
  });

  it('ignores a ruling on a word nobody wrote', () => {
    const ruling = toRuling(
      { rulings: [{ category: 'thing', word: 'Ruby', evidence: 'A colour.', matched: true }] },
      entries
    );

    // Ruby was a name this round, not a thing: a bonus for it would be invented.
    expect(ruling.matched('thing', 'Ruby')).toBe(null);
  });

  it('leaves an answer the model skipped to its own judge', () => {
    const ruling = toRuling({ rulings: [] }, entries);

    expect(ruling.matched('thing', 'Rose')).toBe(null);
  });

  it('keeps the first ruling when the model rules on one answer twice', () => {
    const ruling = toRuling(
      {
        rulings: [
          { category: 'thing', word: 'Rose', evidence: 'A colour.', matched: true },
          { category: 'thing', word: 'Rose', evidence: 'Just a flower.', matched: false },
        ],
      },
      entries
    );

    expect(ruling.matched('thing', 'Rose')).toBe(true);
  });

  it('throws on a response carrying no rulings, so the caller can fall back', () => {
    expect(() => toRuling({}, entries)).toThrow(/no rulings/i);
  });
});

describe('createAzureBonusAdjudicator', () => {
  it('asks once for the whole round, and rules every player by that answer', async () => {
    const { client, create } = fakeClient(
      messageContent(
        JSON.stringify({
          rulings: [
            { category: 'thing', word: 'Rose', evidence: 'A colour.', matched: true },
            { category: 'thing', word: 'Rug', evidence: 'Not a colour.', matched: false },
          ],
        })
      )
    );

    const ruling = await createAzureBonusAdjudicator(client, DEPLOYMENT).adjudicate(request);

    expect(create).toHaveBeenCalledTimes(1);
    expect(ruling.matched('thing', 'Rose')).toBe(true);
    expect(ruling.matched('thing', 'Rug')).toBe(false);
  });

  it('sends the deployment name as the model, in strict json_schema mode', async () => {
    const { client, create } = fakeClient(messageContent(JSON.stringify({ rulings: [] })));

    await createAzureBonusAdjudicator(client, DEPLOYMENT).adjudicate(request);

    const args = create.mock.calls[0][0];
    expect(args.model).toBe(DEPLOYMENT);
    expect(args.response_format.json_schema.strict).toBe(true);
  });

  it('asks at temperature 0, because this call exists to be consistent', async () => {
    const { client, create } = fakeClient(messageContent(JSON.stringify({ rulings: [] })));

    await createAzureBonusAdjudicator(client, DEPLOYMENT).adjudicate(request);

    expect(create.mock.calls[0][0].temperature).toBe(0);
  });

  it('throws on a malformed response, so the round falls back to its own judges', async () => {
    const { client } = fakeClient(messageContent('{"rulings":"soon"}'));

    await expect(
      createAzureBonusAdjudicator(client, DEPLOYMENT).adjudicate(request)
    ).rejects.toThrow();
  });
});
