import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import OpenAI from 'openai';
import { AZURE_TOKEN_SCOPE, AzureConfig } from './config';

const MAX_RETRIES = 3;

export type TokenProvider = () => Promise<string>;

export interface AzureClient {
  client: OpenAI;
  judgeDeployment: string;
  bonusDeployment: string;
}

export interface AzureClientOverrides {
  tokenProvider?: TokenProvider;
  fetch?: typeof fetch;
}

export function createDefaultTokenProvider(): TokenProvider {
  return getBearerTokenProvider(new DefaultAzureCredential(), AZURE_TOKEN_SCOPE);
}

export function createAzureClient(
  config: AzureConfig,
  overrides: AzureClientOverrides = {}
): AzureClient {
  const tokenProvider = overrides.tokenProvider ?? createDefaultTokenProvider();

  return {
    client: new OpenAI({

      baseURL: config.endpoint,
      apiKey: tokenProvider,
      maxRetries: MAX_RETRIES,
      ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    }),
    judgeDeployment: config.judgeDeployment,
    bonusDeployment: config.bonusDeployment,
  };
}
