import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import {
  ContentFilterError,
  EmptyCompletionError,
  MalformedCompletionError,
  ModelRefusedError,
  TruncatedCompletionError,
  createStructuredCompleter,
  harmCategoriesFrom,
  isContentFilterRejection,
} from './jsonSchemaCompleter';

const DEPLOYMENT = 'npat-judge';

const request = {
  system: 'You are a referee.',
  user: 'Judge this round.',
  schemaName: 'verdict',
  schema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  temperature: 0.2,
};

function completerReturning(completion: unknown) {
  const create = vi.fn(async (_args: any) => completion);
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  return { completer: createStructuredCompleter(client, DEPLOYMENT), create };
}

function completerThrowing(err: unknown) {
  const create = vi.fn(async () => {
    throw err;
  });
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  return { completer: createStructuredCompleter(client, DEPLOYMENT), create };
}

function message(content: string | null, extra: Record<string, unknown> = {}) {
  return { choices: [{ message: { content }, finish_reason: 'stop', ...extra }] };
}

function contentFilterError() {
  return Object.assign(new Error('The response was filtered'), {
    status: 400,
    error: {
      code: 'content_filter',
      innererror: {
        code: 'ResponsibleAIPolicyViolation',
        content_filter_result: {
          hate: { filtered: true, severity: 'medium' },
          violence: { filtered: false, severity: 'safe' },
        },
      },
    },
  });
}

describe('the request it builds', () => {
  it('asks for strict structured output against the given schema', async () => {
    const { completer, create } = completerReturning(message('{"ok":true}'));

    await completer.complete(request);

    const args = create.mock.calls[0][0] as any;
    expect(args.response_format.type).toBe('json_schema');
    expect(args.response_format.json_schema.strict).toBe(true);
    expect(args.response_format.json_schema.name).toBe('verdict');
    expect(args.response_format.json_schema.schema).toBe(request.schema);
  });

  it('sends the deployment name as the model', async () => {
    const { completer, create } = completerReturning(message('{}'));

    await completer.complete(request);

    expect((create.mock.calls[0][0] as any).model).toBe(DEPLOYMENT);
  });

  it('splits the prompt into a stable system prefix and a varying user message', async () => {
    const { completer, create } = completerReturning(message('{}'));

    await completer.complete(request);

    const args = create.mock.calls[0][0] as any;
    expect(args.messages).toEqual([
      { role: 'system', content: 'You are a referee.' },
      { role: 'user', content: 'Judge this round.' },
    ]);
  });

  it('passes the temperature through, since callers differ', async () => {
    const { completer, create } = completerReturning(message('{}'));

    await completer.complete({ ...request, temperature: 0.8 });

    expect((create.mock.calls[0][0] as any).temperature).toBe(0.8);
  });
});

describe('what it returns', () => {
  it('parses the JSON the model produced', async () => {
    const { completer } = completerReturning(message('{"title":"Stellar","count":2}'));

    await expect(completer.complete(request)).resolves.toEqual({ title: 'Stellar', count: 2 });
  });
});

describe('the failure taxonomy', () => {
  it('names a content-filter rejection of the prompt, and keeps the harm categories', async () => {
    const { completer } = completerThrowing(contentFilterError());

    await expect(completer.complete(request)).rejects.toBeInstanceOf(ContentFilterError);

    try {
      await completer.complete(request);
    } catch (err) {
      expect((err as ContentFilterError).harmCategories).toEqual(['hate']);
    }
  });

  it('names a content-filter rejection of the response', async () => {
    const { completer } = completerReturning({
      choices: [{ message: { content: null }, finish_reason: 'content_filter' }],
    });

    await expect(completer.complete(request)).rejects.toBeInstanceOf(ContentFilterError);
  });

  it('names a refusal, rather than reporting it as empty content', async () => {
    const { completer } = completerReturning({
      choices: [{ message: { refusal: 'I cannot help with that' }, finish_reason: 'stop' }],
    });

    await expect(completer.complete(request)).rejects.toBeInstanceOf(ModelRefusedError);
  });

  it('names a truncation, rather than letting it surface as a JSON syntax error', async () => {

    const { completer } = completerReturning({
      choices: [{ message: { content: '{"title":"Stel' }, finish_reason: 'length' }],
    });

    await expect(completer.complete(request)).rejects.toBeInstanceOf(TruncatedCompletionError);
  });

  it('names an empty response', async () => {
    const { completer } = completerReturning(message(null));

    await expect(completer.complete(request)).rejects.toBeInstanceOf(EmptyCompletionError);
  });

  it('names a response with no choices', async () => {
    const { completer } = completerReturning({ choices: [] });

    await expect(completer.complete(request)).rejects.toBeInstanceOf(EmptyCompletionError);
  });

  it('names content that is not JSON, and says which schema it failed', async () => {
    const { completer } = completerReturning(message('this is not json'));

    await expect(completer.complete(request)).rejects.toBeInstanceOf(MalformedCompletionError);
    await expect(completer.complete(request)).rejects.toThrow(/verdict/);
  });

  it('keeps the parse error as the cause, because it quotes the offending payload', async () => {

    const { completer } = completerReturning(message('<html><body>502</body></html>'));

    await expect(completer.complete(request)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining('<html>') }),
    });
  });

  it('lets an unrelated transport failure through, so retries and fallbacks still see it', async () => {
    const rateLimited = Object.assign(new Error('Too Many Requests'), { status: 429 });
    const { completer } = completerThrowing(rateLimited);

    await expect(completer.complete(request)).rejects.toThrow(/Too Many Requests/);
  });

  it('gives every failure a useful name for logs', async () => {
    const { completer } = completerReturning(message('nope'));

    try {
      await completer.complete(request);
    } catch (err) {
      expect((err as Error).name).toBe('MalformedCompletionError');
    }
  });
});

describe('isContentFilterRejection', () => {
  it('recognises the documented rejection shape', () => {
    expect(isContentFilterRejection(contentFilterError())).toBe(true);
  });

  it('recognises a top-level code too', () => {
    expect(isContentFilterRejection({ status: 400, code: 'content_filter' })).toBe(true);
  });

  it('does not mistake other failures for filtering', () => {
    expect(isContentFilterRejection(new Error('boom'))).toBe(false);
    expect(isContentFilterRejection({ status: 429 })).toBe(false);
    expect(isContentFilterRejection({ status: 500 })).toBe(false);
    expect(isContentFilterRejection(undefined)).toBe(false);
  });
});

describe('harmCategoriesFrom', () => {
  it('reports only the categories that actually filtered', () => {
    expect(harmCategoriesFrom(contentFilterError())).toEqual(['hate']);
  });

  it('returns nothing when there is no filter detail', () => {
    expect(harmCategoriesFrom(new Error('boom'))).toEqual([]);
  });
});
