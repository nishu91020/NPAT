import { CategoryKey, JudgedBy } from '../../src/types';

/** How a daily challenge was obtained, which tells us whether the store is working. */
export type DailyChallengeOrigin = 'memory' | 'store' | 'generated';

export interface RoundJudgedEvent {
  /**
   * Which referee ruled. The signal that matters most: a rise in 'heuristic'
   * means Foundry is failing while the game still looks healthy, because
   * withFallback is doing its job silently.
   */
  judgedBy: JudgedBy;
  /** Wall-clock time spent judging, in milliseconds. The player watches this. */
  durationMs: number;
  totalScore: number;
  /** Categories the content filter refused to judge. Usually empty. */
  filteredCategories?: CategoryKey[];
}

export interface DailyChallengeEvent {
  origin: DailyChallengeOrigin;
  dateStr: string;
}

/**
 * The seam for telemetry.
 *
 * Deliberately domain-shaped rather than a generic logger: these are the
 * questions the deployment needs answered, and naming them here stops
 * telemetry sprawling into "log everything and query it later".
 *
 * Implementations must never throw — a telemetry failure must not fail a round.
 */
export interface Telemetry {
  roundJudged(event: RoundJudgedEvent): void;
  dailyChallengeServed(event: DailyChallengeEvent): void;
  /** Something failed in a way worth alerting on. */
  failure(operation: string, error: unknown): void;
}

/** Used when telemetry is not configured. Keeps call sites free of null checks. */
export const noopTelemetry: Telemetry = {
  roundJudged() {},
  dailyChallengeServed() {},
  failure() {},
};

/** Records into arrays. The test substitute. */
export function createRecordingTelemetry() {
  const rounds: RoundJudgedEvent[] = [];
  const dailyChallenges: DailyChallengeEvent[] = [];
  const failures: { operation: string; error: unknown }[] = [];

  const telemetry: Telemetry = {
    roundJudged(event) {
      rounds.push(event);
    },
    dailyChallengeServed(event) {
      dailyChallenges.push(event);
    },
    failure(operation, error) {
      failures.push({ operation, error });
    },
  };

  return { telemetry, rounds, dailyChallenges, failures };
}

/**
 * Wraps a telemetry implementation so a failure inside it can never take down
 * the request it was measuring.
 */
export function neverThrows(inner: Telemetry): Telemetry {
  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      console.error('Telemetry failed, continuing:', err);
    }
  };

  return {
    roundJudged: (event) => guard(() => inner.roundJudged(event)),
    dailyChallengeServed: (event) => guard(() => inner.dailyChallengeServed(event)),
    failure: (operation, error) => guard(() => inner.failure(operation, error)),
  };
}
