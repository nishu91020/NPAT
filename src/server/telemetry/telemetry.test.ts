import { Span } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import { createAzureMonitorTelemetry } from './azureMonitor';
import { resolveTelemetryConfig } from './config';
import { createRecordingTelemetry, neverThrows, noopTelemetry } from './types';

describe('resolveTelemetryConfig', () => {
  it('is unconfigured when the connection string is absent', () => {
    expect(resolveTelemetryConfig({})).toEqual({ kind: 'unconfigured' });
  });

  it('is unconfigured when the connection string is blank', () => {
    expect(resolveTelemetryConfig({ APPLICATIONINSIGHTS_CONNECTION_STRING: '   ' })).toEqual({
      kind: 'unconfigured',
    });
  });

  it('resolves a connection string, trimming whitespace from a copy-paste', () => {
    const result = resolveTelemetryConfig({
      APPLICATIONINSIGHTS_CONNECTION_STRING: '  InstrumentationKey=abc;IngestionEndpoint=x  ',
    });

    expect(result).toEqual({
      kind: 'configured',
      connectionString: 'InstrumentationKey=abc;IngestionEndpoint=x',
    });
  });

  it('ignores unrelated environment variables', () => {
    expect(resolveTelemetryConfig({ PATH: '/usr/bin' })).toEqual({ kind: 'unconfigured' });
  });
});

/** Stands in for the request span the auto instrumentation creates. */
function fakeSpan() {
  const attributes: Record<string, unknown> = {};
  const exceptions: unknown[] = [];

  const span = {
    setAttributes: vi.fn((attrs: Record<string, unknown>) => {
      Object.assign(attributes, attrs);
      return span;
    }),
    recordException: vi.fn((err: unknown) => {
      exceptions.push(err);
    }),
  } as unknown as Span;

  return { span, attributes, exceptions };
}

describe('createAzureMonitorTelemetry', () => {
  it('tags the request span with the judge that ruled', () => {
    const { span, attributes } = fakeSpan();
    const telemetry = createAzureMonitorTelemetry(() => span);

    telemetry.roundJudged({ judgedBy: 'heuristic', durationMs: 12, totalScore: 40 });

    // The signal that matters: a rise in 'heuristic' means Foundry is failing
    // while the game still looks healthy.
    expect(attributes['npat.judged_by']).toBe('heuristic');
    expect(attributes['npat.judge_duration_ms']).toBe(12);
    expect(attributes['npat.total_score']).toBe(40);
  });

  it('records filtered categories as a count, so it aggregates in a query', () => {
    const { span, attributes } = fakeSpan();
    const telemetry = createAzureMonitorTelemetry(() => span);

    telemetry.roundJudged({
      judgedBy: 'azure',
      durationMs: 5000,
      totalScore: 30,
      filteredCategories: ['name', 'thing'],
    });

    expect(attributes['npat.filtered_categories']).toBe(2);
  });

  it('reports zero filtered categories when none were blocked', () => {
    const { span, attributes } = fakeSpan();
    createAzureMonitorTelemetry(() => span).roundJudged({
      judgedBy: 'azure',
      durationMs: 100,
      totalScore: 80,
    });

    expect(attributes['npat.filtered_categories']).toBe(0);
  });

  it('tags where the daily challenge came from', () => {
    const { span, attributes } = fakeSpan();

    createAzureMonitorTelemetry(() => span).dailyChallengeServed({
      origin: 'store',
      dateStr: '2026-08-08',
    });

    expect(attributes['npat.daily_origin']).toBe('store');
    expect(attributes['npat.daily_date']).toBe('2026-08-08');
  });

  it('records a failure as an exception on the span', () => {
    const { span, attributes, exceptions } = fakeSpan();
    const boom = new Error('foundry exploded');

    createAzureMonitorTelemetry(() => span).failure('judge', boom);

    expect(attributes['npat.failed_operation']).toBe('judge');
    expect(exceptions).toEqual([boom]);
  });

  it('converts a non-Error into an Error, since recordException expects one', () => {
    const { span, exceptions } = fakeSpan();

    createAzureMonitorTelemetry(() => span).failure('judge', 'just a string');

    expect(exceptions[0]).toBeInstanceOf(Error);
    expect((exceptions[0] as Error).message).toBe('just a string');
  });

  it('does nothing when there is no active span, rather than throwing', () => {
    const telemetry = createAzureMonitorTelemetry(() => undefined);

    expect(() => {
      telemetry.roundJudged({ judgedBy: 'azure', durationMs: 1, totalScore: 1 });
      telemetry.dailyChallengeServed({ origin: 'memory', dateStr: '2026-08-08' });
      telemetry.failure('judge', new Error('x'));
    }).not.toThrow();
  });

  it('survives a span that throws, so telemetry cannot fail a round', () => {
    const exploding = {
      setAttributes: () => {
        throw new Error('span exploded');
      },
      recordException: () => {},
    } as unknown as Span;

    const telemetry = createAzureMonitorTelemetry(() => exploding);

    expect(() =>
      telemetry.roundJudged({ judgedBy: 'azure', durationMs: 1, totalScore: 1 })
    ).not.toThrow();
  });
});

describe('neverThrows', () => {
  it('swallows a failure in the wrapped implementation', () => {
    const broken = {
      roundJudged() {
        throw new Error('boom');
      },
      dailyChallengeServed() {
        throw new Error('boom');
      },
      failure() {
        throw new Error('boom');
      },
    };

    const safe = neverThrows(broken);

    expect(() => {
      safe.roundJudged({ judgedBy: 'azure', durationMs: 1, totalScore: 1 });
      safe.dailyChallengeServed({ origin: 'memory', dateStr: '2026-08-08' });
      safe.failure('judge', new Error('x'));
    }).not.toThrow();
  });

  it('still passes events through when nothing throws', () => {
    const { telemetry, rounds } = createRecordingTelemetry();

    neverThrows(telemetry).roundJudged({ judgedBy: 'azure', durationMs: 3, totalScore: 50 });

    expect(rounds).toHaveLength(1);
  });
});

describe('noopTelemetry', () => {
  it('accepts every event without throwing, so call sites need no null checks', () => {
    expect(() => {
      noopTelemetry.roundJudged({ judgedBy: 'azure', durationMs: 1, totalScore: 1 });
      noopTelemetry.dailyChallengeServed({ origin: 'generated', dateStr: '2026-08-08' });
      noopTelemetry.failure('judge', new Error('x'));
    }).not.toThrow();
  });
});
