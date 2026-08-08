import { describe, expect, it } from 'vitest';
import { createAzureClient } from './client';
import { AzureConfig } from './config';

const config: AzureConfig = {
  kind: 'configured',
  endpoint: 'https://my-resource.openai.azure.com',
  apiKey: 'secret-key',
  judgeDeployment: 'npat-judge',
  bonusDeployment: 'npat-bonus',
};

describe('createAzureClient', () => {
  it('targets the stable /openai/v1/ route', () => {
    const { client } = createAzureClient(config);

    expect(client.baseURL).toBe('https://my-resource.openai.azure.com/openai/v1/');
  });

  it('does not append an api-version query parameter', () => {
    const { client } = createAzureClient(config);

    expect(client.baseURL).not.toContain('api-version');
  });

  it('retries so transient 429s and 5xx are handled by the SDK', () => {
    const { client } = createAzureClient(config);

    expect(client.maxRetries).toBe(3);
  });

  it('carries both deployment names, since they are what the API calls "model"', () => {
    const azure = createAzureClient(config);

    expect(azure.judgeDeployment).toBe('npat-judge');
    expect(azure.bonusDeployment).toBe('npat-bonus');
  });
});
