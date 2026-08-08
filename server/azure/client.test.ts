import { describe, expect, it, vi } from 'vitest';
import { createAzureClient } from './client';
import { AZURE_TOKEN_SCOPE, AzureConfig } from './config';

const config: AzureConfig = {
  kind: 'configured',
  endpoint: 'https://my-resource.openai.azure.com',
  judgeDeployment: 'npat-judge',
  bonusDeployment: 'npat-bonus',
};

const tokenProvider = async () => 'fake-entra-token';

describe('createAzureClient', () => {
  it('targets the stable /openai/v1/ route', () => {
    const { client } = createAzureClient(config, { tokenProvider });

    expect(client.baseURL).toBe('https://my-resource.openai.azure.com/openai/v1/');
  });

  it('does not append an api-version query parameter', () => {
    const { client } = createAzureClient(config, { tokenProvider });

    expect(client.baseURL).not.toContain('api-version');
  });

  it('does not use the legacy /deployments/ path', () => {
    const { client } = createAzureClient(config, { tokenProvider });

    expect(client.baseURL).not.toContain('/deployments');
  });

  it('retries so transient 429s and 5xx are handled by the SDK', () => {
    const { client } = createAzureClient(config, { tokenProvider });

    expect(client.maxRetries).toBe(3);
  });

  it('carries both deployment names, since they are what the API calls "model"', () => {
    const azure = createAzureClient(config, { tokenProvider });

    expect(azure.judgeDeployment).toBe('npat-judge');
    expect(azure.bonusDeployment).toBe('npat-bonus');
  });

  it('stores no secret on the client — the credential is fetched per request', () => {
    const { client } = createAzureClient(config, { tokenProvider });

    expect(client.apiKey).toBeNull();
  });

  it('sends the Entra token as a bearer credential on the request', async () => {
    const provider = vi.fn(async () => 'fake-entra-token');
    let seenAuth: string | null = null;

    const fetchImpl = (async (_input: unknown, init: RequestInit | undefined) => {
      seenAuth = new Headers(init?.headers).get('authorization');
      return new Response(JSON.stringify({ id: 'x', object: 'chat.completion', choices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const { client } = createAzureClient(config, { tokenProvider: provider, fetch: fetchImpl });
    await client.chat.completions.create({
      model: 'npat-judge',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(provider).toHaveBeenCalled();
    expect(seenAuth).toBe('Bearer fake-entra-token');
  });

  it('refreshes the token per request rather than caching it forever', async () => {
    let issued = 0;
    const provider = vi.fn(async () => `token-${++issued}`);
    const seen: (string | null)[] = [];

    const fetchImpl = (async (_input: unknown, init: RequestInit | undefined) => {
      seen.push(new Headers(init?.headers).get('authorization'));
      return new Response(JSON.stringify({ id: 'x', object: 'chat.completion', choices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const { client } = createAzureClient(config, { tokenProvider: provider, fetch: fetchImpl });
    const call = () =>
      client.chat.completions.create({
        model: 'npat-judge',
        messages: [{ role: 'user', content: 'hi' }],
      });

    await call();
    await call();

    expect(seen).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it('uses the ai.azure.com scope, not the older cognitiveservices one', () => {
    expect(AZURE_TOKEN_SCOPE).toBe('https://ai.azure.com/.default');
    expect(AZURE_TOKEN_SCOPE).not.toContain('cognitiveservices');
  });
});
