import { Span, trace } from '@opentelemetry/api';
import {
  DailyChallengeEvent,
  RoundJudgedEvent,
  Telemetry,
  neverThrows,
} from './types';

/**
 * Records domain facts as attributes on the request span the auto
 * instrumentation already created.
 *
 * Riding the existing request span rather than emitting separate events means
 * these land as `customDimensions` on the request telemetry, alongside its
 * duration and success — so a single query answers "what fraction of rounds
 * fell back to the heuristic", at no extra ingestion cost.
 */
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
        // A count rather than a list, so it aggregates in a query.
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

  // A telemetry bug must never fail a round.
  return neverThrows(telemetry);
}
