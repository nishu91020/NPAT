import OpenAI from 'openai';
import { AzureConfig } from './config';

/** Retries cover 429s and transient 5xx; content-filter 400s are never retried. */
const MAX_RETRIES = 3;

export interface AzureClient {
  client: OpenAI;
  judgeDeployment: string;
  bonusDeployment: string;
}

/**
 * Builds the client for the stable /openai/v1/ route, which takes no
 * api-version query parameter.
 */
export function createAzureClient(config: AzureConfig): AzureClient {
  return {
    client: new OpenAI({
      baseURL: `${config.endpoint}/openai/v1/`,
      apiKey: config.apiKey,
      maxRetries: MAX_RETRIES,
    }),
    judgeDeployment: config.judgeDeployment,
    bonusDeployment: config.bonusDeployment,
  };
}
