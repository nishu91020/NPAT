export const AZURE_ENV_VARS = [
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_JUDGE_DEPLOYMENT',
  'AZURE_OPENAI_BONUS_DEPLOYMENT',
] as const;

export type AzureEnvVar = (typeof AZURE_ENV_VARS)[number];

export const AZURE_TOKEN_SCOPE = 'https://ai.azure.com/.default';

export interface AzureConfig {
  kind: 'configured';
  endpoint: string;
  judgeDeployment: string;
  bonusDeployment: string;
}

export type AzureConfigResult =
  | AzureConfig

  | { kind: 'unconfigured' }

  | { kind: 'incomplete'; missing: AzureEnvVar[] };

function read(env: Record<string, string | undefined>, key: AzureEnvVar): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function normaliseEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  const withoutSuffix = trimmed.replace(/\/openai(\/v1)?$/i, '');

  return `${withoutSuffix}/openai/v1`;
}

export function resolveAzureConfig(env: Record<string, string | undefined>): AzureConfigResult {
  const present = AZURE_ENV_VARS.filter((key) => read(env, key) !== undefined);

  if (present.length === 0) return { kind: 'unconfigured' };

  const missing = AZURE_ENV_VARS.filter((key) => read(env, key) === undefined);
  if (missing.length > 0) return { kind: 'incomplete', missing };

  return {
    kind: 'configured',

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
