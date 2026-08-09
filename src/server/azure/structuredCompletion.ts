import type OpenAI from 'openai';

/**
 * Everything that can go wrong asking a model for schema-conforming JSON.
 *
 * A named taxonomy rather than bare Errors, because callers act differently on
 * each: a content-filter rejection is permanent and must never be retried, a
 * truncation might succeed on a smaller prompt, and a malformed response means
 * the model ignored the schema.
 */
export class CompletionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * The content filter rejected the prompt or the response.
 *
 * Permanent for that content: retrying the same request unchanged fails
 * identically.
 */
export class ContentFilterError extends CompletionError {
  readonly harmCategories: string[];

  constructor(message: string, harmCategories: string[] = []) {
    super(message);
    this.harmCategories = harmCategories;
  }
}

/** The model declined to answer. */
export class ModelRefusedError extends CompletionError {}

/** The response hit the token limit, so the JSON is incomplete. */
export class TruncatedCompletionError extends CompletionError {}

/** The response carried no content at all. */
export class EmptyCompletionError extends CompletionError {}

/** Content came back, but it was not the JSON the schema required. */
export class MalformedCompletionError extends CompletionError {}

/** Recognises the documented content-filter rejection shape. */
export function isContentFilterRejection(err: unknown): boolean {
  const anyErr = err as
    | { status?: number; code?: string; error?: { code?: string }; message?: string }
    | undefined;
  if (!anyErr) return false;

  const code = anyErr.code ?? anyErr.error?.code;
  if (code === 'content_filter') return true;

  return anyErr.status === 400 && Boolean(anyErr.message?.includes('content_filter'));
}

export function harmCategoriesFrom(err: unknown): string[] {
  const inner = (err as any)?.error?.innererror ?? (err as any)?.innererror;
  const result = inner?.content_filter_result;
  if (!result || typeof result !== 'object') return [];

  return Object.entries(result)
    .filter(([, value]) => (value as { filtered?: boolean })?.filtered)
    .map(([category]) => category);
}

export interface CompletionRequest {
  /** Fixed persona and rules. Kept stable so the provider can cache the prefix. */
  system: string;
  /** The varying per-request data. */
  user: string;
  /** Names the schema in the request; appears in provider logs. */
  schemaName: string;
  /**
   * JSON Schema in the strict-mode subset: `additionalProperties: false` on
   * every object, every property in `required`, and no `maxLength` or numeric
   * bounds — strict mode rejects them.
   */
  schema: Record<string, unknown>;
  temperature: number;
}

/**
 * Asks a model for JSON matching a schema.
 *
 * The whole point is that a caller learns one method and gets the strict-mode
 * request shape, the response unwrapping, the full failure taxonomy and the
 * parse — none of which is domain knowledge, and all of which was previously
 * duplicated across adapters and had already drifted.
 */
export interface StructuredCompleter {
  complete<T>(request: CompletionRequest): Promise<T>;
}

export function createStructuredCompleter(
  client: OpenAI,
  deployment: string
): StructuredCompleter {
  return {
    async complete<T>(request: CompletionRequest): Promise<T> {
      let response;

      try {
        response = await client.chat.completions.create({
          // The deployment name, which is what the API's `model` expects — not
          // the underlying model name.
          model: deployment,
          temperature: request.temperature,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: request.schemaName,
              strict: true,
              schema: request.schema,
            },
          },
        });
      } catch (err) {
        // The filter can reject the prompt before the model ever sees it.
        if (isContentFilterRejection(err)) {
          throw new ContentFilterError(
            'Request rejected by the content filter',
            harmCategoriesFrom(err)
          );
        }
        throw err;
      }

      const choice = response.choices?.[0];
      if (!choice) throw new EmptyCompletionError('Model returned no choices');

      if (choice.message?.refusal) {
        throw new ModelRefusedError(`Model refused: ${choice.message.refusal}`);
      }

      // The filter can also reject the response after generating it.
      if (choice.finish_reason === 'content_filter') {
        throw new ContentFilterError('Response rejected by the content filter');
      }

      if (choice.finish_reason === 'length') {
        throw new TruncatedCompletionError('Model response was truncated');
      }

      const content = choice.message?.content;
      if (!content) throw new EmptyCompletionError('Model returned empty content');

      try {
        return JSON.parse(content) as T;
      } catch (err) {
        // Without this a truncated or non-JSON response surfaces as a bare
        // SyntaxError with no indication of which call produced it. The cause
        // is kept because its message quotes the offending payload, which is
        // what separates "the model wrote prose" from "a gateway returned HTML".
        throw new MalformedCompletionError(
          `Model returned content that was not valid JSON for schema "${request.schemaName}"`,
          { cause: err }
        );
      }
    },
  };
}
