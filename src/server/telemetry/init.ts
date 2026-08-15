import { shutdownAzureMonitor, useAzureMonitor } from '@azure/monitor-opentelemetry';
import dotenv from 'dotenv';
import { resolveTelemetryConfig } from './config';

dotenv.config({ path: '.env' });
dotenv.config();

const config = resolveTelemetryConfig(process.env);

function start(): boolean {
  if (config.kind !== 'configured') return false;

  try {
    useAzureMonitor({
      azureMonitorExporterOptions: { connectionString: config.connectionString },

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

export async function flushTelemetry(): Promise<void> {
  if (!telemetryStarted) return;

  try {
    await shutdownAzureMonitor();
  } catch (err) {
    console.error('Telemetry flush failed:', err);
  }
}
