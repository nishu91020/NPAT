export const AZURE_ENV_VARS = [
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_JUDGE_DEPLOYMENT',
  'AZURE_OPENAI_BONUS_DEPLOYMENT',
] as const;

export type AzureEnvVar = (typeof AZURE_ENV_VARS)[number];

/**
 * Scope for the /openai/v1/ endpoint. Note this is NOT the older
 * https://cognitiveservices.azure.com/.default scope, which is a documented
 * cause of 401s against this route.
 */
export const AZURE_TOKEN_SCOPE = 'https://ai.azure.com/.default';

export interface AzureConfig {
  kind: 'configured';
  endpoint: string;
  judgeDeployment: string;
  bonusDeployment: string;
}

export type AzureConfigResult =
  | AzureConfig
  /** Nothing set at all — a supported mode, the app runs heuristic-only. */
  | { kind: 'unconfigured' }
  /** Some but not all set — almost always a typo, so it is never silently ignored. */
  | { kind: 'incomplete'; missing: AzureEnvVar[] };

function read(env: Record<string, string | undefined>, key: AzureEnvVar): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/**
 * Produces the base URL the client should call, accepting either form of
 * endpoint people copy out of the portal:
 *
 *   https://my-resource.services.ai.azure.com
 *   https://my-resource.services.ai.azure.com/openai/v1
 *   https://my-resource.openai.azure.com
 *
 * The portal's own sample includes the /openai/v1 suffix, so appending it
 * blindly would produce /openai/v1/openai/v1.
 */
export function normaliseEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  const withoutSuffix = trimmed.replace(/\/openai(\/v1)?$/i, '');

  return `${withoutSuffix}/openai/v1`;
}

/**
 * Resolves configuration from an env-shaped object rather than reading
 * process.env directly, so every permutation is testable.
 *
 * Credentials are deliberately absent: authentication is Microsoft Entra ID via
 * DefaultAzureCredential, which resolves from `az login` locally and from a
 * managed identity once hosted. There is no secret to configure.
 */
export function resolveAzureConfig(env: Record<string, string | undefined>): AzureConfigResult {
  const present = AZURE_ENV_VARS.filter((key) => read(env, key) !== undefined);

  if (present.length === 0) return { kind: 'unconfigured' };

  const missing = AZURE_ENV_VARS.filter((key) => read(env, key) === undefined);
  if (missing.length > 0) return { kind: 'incomplete', missing };

  return {
    kind: 'configured',
    // Normalised to exactly one /openai/v1, whichever form was pasted in.
    endpoint: normaliseEndpoint(read(env, 'AZURE_OPENAI_ENDPOINT')!),
    judgeDeployment: read(env, 'AZURE_OPENAI_JUDGE_DEPLOYMENT')!,
    bonusDeployment: read(env, 'AZURE_OPENAI_BONUS_DEPLOYMENT')!,
  };
}

export function describeIncompleteConfig(missing: AzureEnvVar[]): string {
  return [
    'Microsoft Foundry is partly configured, which is almost always a mistake.',
    `Missing: ${missing.join(', ')}.`,
    'Set every variable to enable AI judging, or none to run on the heuristic judge.',
  ].join(' ');
}
