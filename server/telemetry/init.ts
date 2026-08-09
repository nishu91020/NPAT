import { shutdownAzureMonitor, useAzureMonitor } from '@azure/monitor-opentelemetry';
import dotenv from 'dotenv';
import { resolveTelemetryConfig } from './config';

/**
 * Starts Azure Monitor instrumentation.
 *
 * **This module must be imported before anything else.** The OpenTelemetry
 * instrumentations patch `http` and `express` when they load, so anything
 * imported earlier is never instrumented and its telemetry is silently lost.
 * `server/main.ts` imports this on its first line for exactly that reason.
 *
 * Importing it is the side effect; there is nothing to call.
 */

// Loading .env here too, because this module runs before server/main.ts reaches its
// own dotenv call — otherwise the connection string is invisible locally.
// dotenv does not override variables that are already set, so the real
// environment still wins in Azure.
dotenv.config({ path: '.env' });
dotenv.config();

const config = resolveTelemetryConfig(process.env);

/**
 * Whether instrumentation actually started.
 *
 * Not the same as "configured": the exporter throws synchronously on a
 * connection string it cannot parse, and because this module is imported first
 * that would escape as an uncaught exception and the server would never listen.
 * A typo in one environment variable would take the game down to gain nothing.
 * Telemetry is optional, so a bad value degrades to no telemetry.
 */
function start(): boolean {
  if (config.kind !== 'configured') return false;

  try {
    useAzureMonitor({
      azureMonitorExporterOptions: { connectionString: config.connectionString },
      // No sampling. This traffic is far below the free ingestion allowance, and
      // sampling would make rare events — the failures worth seeing — invisible.
      samplingRatio: 1,
    });

    console.log('Application Insights enabled.');
    return true;
  } catch (err) {
    console.error('Application Insights failed to start; continuing without telemetry:', err);
    return false;
  }
}

export const telemetryStarted = start();

/**
 * Flushes buffered telemetry. Safe to call when telemetry never started.
 *
 * Nothing in the SDK registers a SIGTERM handler, so without an explicit flush
 * the spans still sitting in the batch processor are lost when the process
 * exits.
 */
export async function flushTelemetry(): Promise<void> {
  if (!telemetryStarted) return;

  try {
    await shutdownAzureMonitor();
  } catch (err) {
    console.error('Telemetry flush failed:', err);
  }
}
