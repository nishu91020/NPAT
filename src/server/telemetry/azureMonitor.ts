import { Span, trace } from '@opentelemetry/api';
import {
  DailyChallengeEvent,
  RoundJudgedEvent,
  Telemetry,
  neverThrows,
} from './types';

export function createAzureMonitorTelemetry(
  activeSpan: () => Span | undefined = () => trace.getActiveSpan()
): Telemetry {
  function setOnRequest(attributes: Record<string, string | number | boolean>) {
    activeSpan()?.setAttributes(attributes);
  }

  const telemetry: Telemetry = {
    roundJudged(event: RoundJudgedEvent) {
      const filtered = event.filteredCategories ?? [];

      setOnRequest({
        'npat.judged_by': event.judgedBy,
        'npat.judge_duration_ms': event.durationMs,
        'npat.total_score': event.totalScore,

        'npat.filtered_categories': filtered.length,
      });
    },

    dailyChallengeServed(event: DailyChallengeEvent) {
      setOnRequest({
        'npat.daily_origin': event.origin,
        'npat.daily_date': event.dateStr,
      });
    },

    failure(operation: string, error: unknown) {
      const span = activeSpan();
      if (!span) return;

      span.setAttributes({ 'npat.failed_operation': operation });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
    },
  };

  return neverThrows(telemetry);
}
