export const AZURE_ENV_VARS = [
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_JUDGE_DEPLOYMENT',
  'AZURE_OPENAI_BONUS_DEPLOYMENT',
] as const;

export type AzureEnvVar = (typeof AZURE_ENV_VARS)[number];

export interface AzureConfig {
  kind: 'configured';
  endpoint: string;
  apiKey: string;
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
 * Resolves configuration from an env-shaped object rather than reading
 * process.env directly, so every permutation is testable.
 */
export function resolveAzureConfig(env: Record<string, string | undefined>): AzureConfigResult {
  const present = AZURE_ENV_VARS.filter((key) => read(env, key) !== undefined);

  if (present.length === 0) return { kind: 'unconfigured' };

  const missing = AZURE_ENV_VARS.filter((key) => read(env, key) === undefined);
  if (missing.length > 0) return { kind: 'incomplete', missing };

  return {
    kind: 'configured',
    // Trailing slash removed so joining with /openai/v1/ never doubles up.
    endpoint: read(env, 'AZURE_OPENAI_ENDPOINT')!.replace(/\/+$/, ''),
    apiKey: read(env, 'AZURE_OPENAI_API_KEY')!,
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
