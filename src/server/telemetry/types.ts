import { CategoryKey, JudgedBy } from '../../shared/contract';

export type DailyChallengeOrigin = 'memory' | 'store' | 'generated';

export interface RoundJudgedEvent {

  judgedBy: JudgedBy;

  durationMs: number;
  totalScore: number;

  filteredCategories?: CategoryKey[];
}

export interface DailyChallengeEvent {
  origin: DailyChallengeOrigin;
  dateStr: string;
}

export interface Telemetry {
  roundJudged(event: RoundJudgedEvent): void;
  dailyChallengeServed(event: DailyChallengeEvent): void;

  failure(operation: string, error: unknown): void;
}

export const noopTelemetry: Telemetry = {
  roundJudged() {},
  dailyChallengeServed() {},
  failure() {},
};

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
