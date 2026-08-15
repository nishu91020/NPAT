export type TelemetryConfig =
  | { kind: 'configured'; connectionString: string }
  | { kind: 'unconfigured' };

export function resolveTelemetryConfig(
  env: Record<string, string | undefined>
): TelemetryConfig {
  const connectionString = env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim();

  if (!connectionString) return { kind: 'unconfigured' };

  return { kind: 'configured', connectionString };
}
