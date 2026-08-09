/**
 * Resolves telemetry configuration.
 *
 * The connection string is write-only telemetry ingestion, not a credential: it
 * grants no read access to anything, so it is treated as ordinary configuration
 * rather than a secret. That is a deliberate decision — this project otherwise
 * holds a strict "no secrets in configuration" property.
 */
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
