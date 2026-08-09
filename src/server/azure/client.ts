import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import OpenAI from 'openai';
import { AZURE_TOKEN_SCOPE, AzureConfig } from './config';

/** Retries cover 429s and transient 5xx; content-filter 400s are never retried. */
const MAX_RETRIES = 3;

/** Returns a bearer token. Called per request, so expiring tokens refresh. */
export type TokenProvider = () => Promise<string>;

export interface AzureClient {
  client: OpenAI;
  judgeDeployment: string;
  bonusDeployment: string;
}

/** Seams for testing: a stub credential and a stub transport. */
export interface AzureClientOverrides {
  tokenProvider?: TokenProvider;
  fetch?: typeof fetch;
}

/**
 * Microsoft Entra ID token provider. DefaultAzureCredential resolves from
 * `az login` during local development and from a managed identity once hosted,
 * so no secret is ever stored or configured. The credential caches and refreshes
 * tokens internally.
 */
export function createDefaultTokenProvider(): TokenProvider {
  return getBearerTokenProvider(new DefaultAzureCredential(), AZURE_TOKEN_SCOPE);
}

/**
 * Builds the client for the stable /openai/v1/ route, which takes no
 * api-version query parameter.
 *
 * Deliberately not the SDK's AzureOpenAI class: that one requires an apiVersion
 * and rewrites requests onto the legacy /openai/deployments/{name}/ path. The
 * base client accepts a token-provider function as `apiKey` and calls it per
 * request, which is exactly the refresh behaviour Entra tokens need.
 */
export function createAzureClient(
  config: AzureConfig,
  overrides: AzureClientOverrides = {}
): AzureClient {
  const tokenProvider = overrides.tokenProvider ?? createDefaultTokenProvider();

  return {
    client: new OpenAI({
      // Already normalised to end in /openai/v1 by resolveAzureConfig.
      baseURL: config.endpoint,
      apiKey: tokenProvider,
      maxRetries: MAX_RETRIES,
      ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    }),
    judgeDeployment: config.judgeDeployment,
    bonusDeployment: config.bonusDeployment,
  };
}
