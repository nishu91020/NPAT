import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { BonusChallenge } from '../../shared/contract';
import {
  JUDGE_SYSTEM_PROMPT,
  buildUserPrompt,
  buildVerdictSchema,
  createAzureJudge,
} from './azureJudge';

const bonus: BonusChallenge = {
  id: 'long_words',
  title: 'Super Size Words',
  description: 'All 4 answers must be at least 5 letters long.',
  icon: 'Sparkles',
  ruleHint: 'Words must contain 5+ letters.',
};

const request = {
  letter: 'S',
  answers: { name: 'Sarah', place: 'Spain', animal: 'Shark', thing: 'Spoon' },
  bonusChallenge: bonus,
};

const DEPLOYMENT = 'npat-judge';

/** Stands in for the client so the adapter is testable without a network. */
function fakeClient(completion: unknown) {
  const create = vi.fn(async (_args: any) => completion);
  return {
    client: { chat: { completions: { create } } } as unknown as OpenAI,
    create,
  };
}

function messageContent(content: string, extra: Record<string, unknown> = {}) {
  return {
    choices: [{ message: { content }, finish_reason: 'stop', ...extra }],
  };
}

function fullVerdict(over: Record<string, unknown> = {}) {
  const category = {
    valid: true,
    bonusEvidence: 'Fits the rule.',
    bonusMatched: true,
    feedback: 'Nice',
    suggestion: '',
  };
  return JSON.stringify({
    categories: { name: category, place: category, animal: category, thing: category },
    overallFeedback: 'Well played',
    bonusChallengeMet: true,
    ...over,
  });
}

describe('buildVerdictSchema', () => {
  const schema = buildVerdictSchema() as any;

  it('sets additionalProperties false on every object, as strict mode requires', () => {
    const objects: any[] = [];
    const walk = (node: any) => {
      if (node && typeof node === 'object') {
        if (node.type === 'object') objects.push(node);
        Object.values(node).forEach(walk);
      }
    };
    walk(schema);

    expect(objects.length).toBe(6); // root + categories + four judgements
    for (const obj of objects) {
      expect(obj.additionalProperties).toBe(false);
    }
  });

  it('orders bonusEvidence before bonusMatched, so reasoning precedes the verdict', () => {
    // Structured output is generated in schema order. Observed live: the model
    // asserted a bonus match its own feedback then contradicted.
    const props = Object.keys(schema.properties.categories.properties.name.properties);

    expect(props.indexOf('bonusEvidence')).toBeLessThan(props.indexOf('bonusMatched'));
  });

  it('asks for a suggestion, so a wrong answer can be shown a right one', () => {
    expect(schema.properties.categories.properties.name.properties.suggestion).toEqual({
      type: 'string',
    });
  });

  it('lists every property as required, as strict mode requires', () => {
    const check = (node: any) => {
      if (node && typeof node === 'object') {
        if (node.type === 'object') {
          expect([...node.required].sort()).toEqual(Object.keys(node.properties).sort());
        }
        Object.values(node).forEach(check);
      }
    };
    check(schema);
  });

  it('uses no $ref or $defs, keeping the wire format to plain JSON Schema', () => {
    expect(JSON.stringify(schema)).not.toContain('$ref');
    expect(JSON.stringify(schema)).not.toContain('$defs');
  });

  it('omits points, so the model cannot invent a score', () => {
    expect(JSON.stringify(schema)).not.toContain('points');
  });

  it('describes all four categories', () => {
    expect(Object.keys(schema.properties.categories.properties)).toEqual([
      'name',
      'place',
      'animal',
      'thing',
    ]);
  });
});

describe('prompt split', () => {
  it('keeps the persona and rules out of the per-round message, so the prefix is cacheable', () => {
    const user = buildUserPrompt(request);

    expect(JUDGE_SYSTEM_PROMPT).toContain('You are the ultimate fun, fair, and precise AI referee');
    expect(JUDGE_SYSTEM_PROMPT).toContain('Do not assign points');
    expect(user).not.toContain('You are the ultimate');
  });

  it('puts the round data in the user message', () => {
    const user = buildUserPrompt(request);

    expect(user).toContain('Target letter: "S"');
    expect(user).toContain('Sarah');
    expect(user).toContain('Super Size Words');
  });

  it('uppercases the target letter', () => {
    expect(buildUserPrompt({ ...request, letter: 's' })).toContain('Target letter: "S"');
  });

  it('tolerates a missing bonus challenge', () => {
    const user = buildUserPrompt({ ...request, bonusChallenge: undefined as any });

    expect(user).toContain('Bonus');
  });
});

describe('createAzureJudge', () => {
  it('calls the deployment name as the model, not a model name', async () => {
    const { client, create } = fakeClient(messageContent(fullVerdict()));

    await createAzureJudge(client, DEPLOYMENT).judge(request);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: DEPLOYMENT }));
  });

  it('requests strict structured output', async () => {
    const { client, create } = fakeClient(messageContent(fullVerdict()));

    await createAzureJudge(client, DEPLOYMENT).judge(request);

    const args = create.mock.calls[0][0] as any;
    expect(args.response_format.type).toBe('json_schema');
    expect(args.response_format.json_schema.strict).toBe(true);
    expect(args.temperature).toBe(0.2);
  });

  it('sends the persona as a system message and the round as a user message', async () => {
    const { client, create } = fakeClient(messageContent(fullVerdict()));

    await createAzureJudge(client, DEPLOYMENT).judge(request);

    const args = create.mock.calls[0][0] as any;
    expect(args.messages[0].role).toBe('system');
    expect(args.messages[1].role).toBe('user');
    expect(args.messages[1].content).toContain('Sarah');
  });

  it('parses a well-formed verdict and claims the azure identity', async () => {
    const { client } = fakeClient(messageContent(fullVerdict()));

    const verdict = await createAzureJudge(client, DEPLOYMENT).judge(request);

    expect(verdict.judgedBy).toBe('azure');
    expect(verdict.overallFeedback).toBe('Well played');
    expect(verdict.bonusChallengeMet).toBe(true);
    expect(verdict.categories.name).toMatchObject({
      valid: true,
      bonusMatched: true,
      feedback: 'Nice',
    });
  });

  it('does not carry bonusEvidence into the verdict — it only shapes generation', async () => {
    const { client } = fakeClient(messageContent(fullVerdict()));

    const verdict = await createAzureJudge(client, DEPLOYMENT).judge(request);

    expect(verdict.categories.name).not.toHaveProperty('bonusEvidence');
  });

  it('keeps a suggestion for an answer that was wrong', async () => {
    const { client } = fakeClient(
      messageContent(
        JSON.stringify({
          categories: {
            name: {
              valid: false,
              bonusEvidence: 'n/a',
              bonusMatched: false,
              feedback: 'Not a name.',
              suggestion: 'Sarah',
            },
            place: { valid: true, bonusEvidence: 'x', bonusMatched: false, feedback: 'x', suggestion: '' },
            animal: { valid: true, bonusEvidence: 'x', bonusMatched: false, feedback: 'x', suggestion: '' },
            thing: { valid: true, bonusEvidence: 'x', bonusMatched: false, feedback: 'x', suggestion: '' },
          },
        })
      )
    );

    const verdict = await createAzureJudge(client, DEPLOYMENT).judge(request);

    expect(verdict.categories.name.suggestion).toBe('Sarah');
    // A correct answer needs no suggestion, and an empty string is not one.
    expect(verdict.categories.place.suggestion).toBeUndefined();
  });

  it('refuses a bonus match on an answer it just called invalid', async () => {
    const { client } = fakeClient(
      messageContent(
        JSON.stringify({
          categories: {
            name: {
              valid: false,
              bonusEvidence: 'Contradicts itself.',
              bonusMatched: true,
              feedback: 'Not valid.',
              suggestion: 'Sarah',
            },
            place: { valid: true, bonusEvidence: 'x', bonusMatched: false, feedback: 'x', suggestion: '' },
            animal: { valid: true, bonusEvidence: 'x', bonusMatched: false, feedback: 'x', suggestion: '' },
            thing: { valid: true, bonusEvidence: 'x', bonusMatched: false, feedback: 'x', suggestion: '' },
          },
        })
      )
    );

    const verdict = await createAzureJudge(client, DEPLOYMENT).judge(request);

    expect(verdict.categories.name.bonusMatched).toBe(false);
  });

  it('never returns points, even if the model sends them anyway', async () => {
    const { client } = fakeClient(
      messageContent(
        JSON.stringify({
          categories: {
            name: { valid: true, bonusMatched: true, feedback: 'x', points: 9999 },
            place: { valid: true, bonusMatched: false, feedback: 'x' },
            animal: { valid: true, bonusMatched: false, feedback: 'x' },
            thing: { valid: true, bonusMatched: false, feedback: 'x' },
          },
        })
      )
    );

    const verdict = await createAzureJudge(client, DEPLOYMENT).judge(request);

    expect(verdict.categories.name).not.toHaveProperty('points');
  });

  it('coerces loose truthiness into real booleans', async () => {
    const { client } = fakeClient(
      messageContent(
        JSON.stringify({
          categories: {
            name: { valid: 'yes', bonusMatched: 0, feedback: 'x' },
            place: { valid: true, bonusMatched: false, feedback: 'x' },
            animal: { valid: true, bonusMatched: false, feedback: 'x' },
            thing: { valid: true, bonusMatched: false, feedback: 'x' },
          },
        })
      )
    );

    const verdict = await createAzureJudge(client, DEPLOYMENT).judge(request);

    expect(verdict.categories.name.valid).toBe(true);
    expect(verdict.categories.name.bonusMatched).toBe(false);
  });

  it('defaults missing feedback rather than emitting undefined', async () => {
    const { client } = fakeClient(
      messageContent(
        JSON.stringify({
          categories: {
            name: { valid: true, bonusMatched: false },
            place: { valid: true, bonusMatched: false },
            animal: { valid: true, bonusMatched: false },
            thing: { valid: true, bonusMatched: false },
          },
        })
      )
    );

    const verdict = await createAzureJudge(client, DEPLOYMENT).judge(request);

    expect(verdict.categories.name.feedback).toBe('');
    expect(verdict.overallFeedback).toBe('Great effort!');
  });

  describe('failures throw, so withFallback reaches the heuristic', () => {
    it('throws on an empty response', async () => {
      const { client } = fakeClient(messageContent('{}'));

      await expect(createAzureJudge(client, DEPLOYMENT).judge(request)).rejects.toThrow();
    });

    it('throws when a category is missing rather than scoring a partial round', async () => {
      const { client } = fakeClient(
        messageContent(
          JSON.stringify({ categories: { name: { valid: true, bonusMatched: false, feedback: 'x' } } })
        )
      );

      await expect(createAzureJudge(client, DEPLOYMENT).judge(request)).rejects.toThrow(
        /omitted category/
      );
    });

    it('throws on unparseable output', async () => {
      const { client } = fakeClient(messageContent('not json'));

      await expect(createAzureJudge(client, DEPLOYMENT).judge(request)).rejects.toThrow();
    });

    it('throws when there are no choices', async () => {
      const { client } = fakeClient({ choices: [] });

      await expect(createAzureJudge(client, DEPLOYMENT).judge(request)).rejects.toThrow(
        /no choices/
      );
    });

    it('throws when the model refuses', async () => {
      const { client } = fakeClient({
        choices: [{ message: { refusal: 'I cannot help with that' }, finish_reason: 'stop' }],
      });

      await expect(createAzureJudge(client, DEPLOYMENT).judge(request)).rejects.toThrow(/refused/);
    });

    it('does not throw on a filtered response — isolation handles it instead', async () => {
      // See contentFilter.test.ts. A filtered round must not reach the
      // heuristic, or blocked content would be laundered into a score.
      const { client } = fakeClient({
        choices: [{ message: { content: null }, finish_reason: 'content_filter' }],
      });

      const verdict = await createAzureJudge(client, DEPLOYMENT).judge(request);

      expect(verdict.judgedBy).toBe('azure');
      expect(verdict.categories.name.valid).toBe(false);
    });

    it('throws when the response was truncated', async () => {
      const { client } = fakeClient({
        choices: [{ message: { content: '{"categ' }, finish_reason: 'length' }],
      });

      await expect(createAzureJudge(client, DEPLOYMENT).judge(request)).rejects.toThrow(
        /truncated/
      );
    });
  });
});
