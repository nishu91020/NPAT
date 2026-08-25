import type OpenAI from 'openai';

export class CompletionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ContentFilterError extends CompletionError {
  readonly harmCategories: string[];

  constructor(message: string, harmCategories: string[] = []) {
    super(message);
    this.harmCategories = harmCategories;
  }
}

export class ModelRefusedError extends CompletionError {}

export class TruncatedCompletionError extends CompletionError {}

export class EmptyCompletionError extends CompletionError {}

export class MalformedCompletionError extends CompletionError {}

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

  system: string;

  user: string;

  schemaName: string;

  schema: Record<string, unknown>;
  temperature: number;
}

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

        throw new MalformedCompletionError(
          `Model returned content that was not valid JSON for schema "${request.schemaName}"`,
          { cause: err }
        );
      }
    },
  };
}
