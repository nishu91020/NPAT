import { describe, expect, it, vi } from 'vitest';
import type { BonusChallenge, UserAnswers } from '../../shared/contract';
import {
  bonusEntryKey,
  rulingFrom,
  type BonusAdjudicator,
  type Judge,
  type JudgeVerdict,
} from '../referee';
import { createMemoryRoomStore } from './memoryStore';
import { createRoomService } from './service';

const colours: BonusChallenge = {
  id: 'colour_theme',
  title: 'Shade Squad',
  description: 'At least 2 answers must relate to a colour.',
  icon: 'Sparkles',
  ruleHint: 'Two answers should relate to a colour.',
  rule: { scope: 'some', checkKind: 'none', checkValue: '' },
};

const answers: UserAnswers = { name: 'Ruby', place: 'Rome', animal: 'Robin', thing: 'Rose' };

/**
 * A judge that rules the bonus differently every time it is asked — which is
 * what the real one was observed doing on a rule it has to interpret.
 */
function flipFloppingJudge(): Judge {
  let awardBonus = true;

  return {
    async judge(request): Promise<JudgeVerdict> {
      const bonusMatched = awardBonus;
      awardBonus = !awardBonus;

      const categories = {} as JudgeVerdict['categories'];
      for (const key of ['name', 'place', 'animal', 'thing'] as const) {
        const word = request.answers[key]?.trim() ?? '';
        categories[key] = { valid: word !== '', bonusMatched: bonusMatched && word !== '', feedback: '' };
      }

      return { judgedBy: 'azure', categories, bonusChallengeMet: bonusMatched };
    },
  };
}

/** Rules every answer of the round the same way, however many players wrote it. */
function alwaysMatches(): { adjudicator: BonusAdjudicator; adjudicate: ReturnType<typeof vi.fn> } {
  const adjudicate = vi.fn(async (request: any) => {
    const decided = new Map<string, boolean>();
    for (const submission of request.submissions) {
      for (const key of ['name', 'place', 'animal', 'thing'] as const) {
        decided.set(bonusEntryKey(key, submission[key]), true);
      }
    }
    return rulingFrom(decided);
  });

  return { adjudicator: { adjudicate }, adjudicate };
}

async function playRound(deps: { judge: Judge; bonusAdjudicator?: BonusAdjudicator }) {
  let clock = 1_000_000;
  const rooms = createRoomService({
    store: createMemoryRoomStore(),
    judge: deps.judge,
    bonusAdjudicator: deps.bonusAdjudicator,
    nextPuzzle: async () => ({ letter: 'R', bonusChallenge: colours }),
    now: () => clock,
  });

  const created = await rooms.create('p1', 'Ada');
  await rooms.join(created.code, 'p2', 'Bob');
  await rooms.start(created.code, 'p1');

  // The same four answers from both players: any difference in their scores is
  // the referee's doing, not theirs.
  await rooms.submit(created.code, 'p1', answers);
  clock += 1000;
  const view = await rooms.submit(created.code, 'p2', answers);

  expect(view.results).not.toBeNull();
  return view.results!;
}

describe('scoreRound', () => {
  it('gives two players who wrote the same answers the same bonus', async () => {
    const { adjudicator, adjudicate } = alwaysMatches();

    const results = await playRound({ judge: flipFloppingJudge(), bonusAdjudicator: adjudicator });
    const [first, second] = results.rows;

    // The judge disagreed with itself between the two calls; the round-wide
    // ruling is what both players are actually held to.
    expect(first.categories.thing.bonusMatched).toBe(true);
    expect(second.categories.thing.bonusMatched).toBe(true);
    expect(first.totalScore).toBe(second.totalScore);
    // Settled once for the round, not once per player.
    expect(adjudicate).toHaveBeenCalledTimes(1);
  });

  it('leaves the players at the judge\'s mercy when there is no adjudicator', async () => {
    // The degraded mode, kept honest: without a round-wide ruling, a judge that
    // reads the rule differently per call is exactly the inconsistency the
    // adjudicator exists to remove. Scoring still completes.
    const results = await playRound({ judge: flipFloppingJudge() });

    expect(results.rows).toHaveLength(2);
    const matched = results.rows.map((row) => row.categories.thing.bonusMatched);
    expect(matched).toContain(true);
    expect(matched).toContain(false);
  });
});
