import { describe, expect, it } from 'vitest';
import { BonusChallenge, CategoryKey } from '../../shared/contract';
import {
  CATEGORY_KEYS,
  SCORING,
  defaultOverallFeedback,
  evaluateRound,
  pointsFor,
  scoreVerdict,
  speedBonusFor,
  withFallback,
} from './scoring';
import { CategoryJudgement, Judge, JudgeVerdict } from './types';

const bonus: BonusChallenge = {
  id: 'long_words',
  title: 'Super Size Words',
  description: 'All 4 answers must be at least 5 letters long.',
  icon: 'Sparkles',
  ruleHint: 'Words must contain 5+ letters.',
};

function judgement(over: Partial<CategoryJudgement> = {}): CategoryJudgement {
  return { valid: true, bonusMatched: false, feedback: '', ...over };
}

function verdict(
  categories: Partial<Record<CategoryKey, CategoryJudgement>> = {},
  rest: Partial<JudgeVerdict> = {}
): JudgeVerdict {
  const full = {} as Record<CategoryKey, CategoryJudgement>;
  for (const key of CATEGORY_KEYS) {
    full[key] = categories[key] ?? judgement({ valid: false });
  }
  return { judgedBy: 'heuristic', categories: full, ...rest };
}

function stubJudge(result: JudgeVerdict): Judge {
  return { judge: async () => result };
}

describe('speedBonusFor', () => {
  it('awards each tier at its boundary', () => {
    expect(speedBonusFor(20)).toBe(20);
    expect(speedBonusFor(35)).toBe(10);
    expect(speedBonusFor(50)).toBe(5);
  });

  it('drops to the next tier one second past each boundary', () => {
    expect(speedBonusFor(21)).toBe(10);
    expect(speedBonusFor(36)).toBe(5);
    expect(speedBonusFor(51)).toBe(0);
  });

  it('awards the top tier for very fast rounds', () => {
    expect(speedBonusFor(1)).toBe(20);
  });
});

describe('pointsFor', () => {
  it('scores an invalid answer as zero regardless of bonus', () => {
    expect(pointsFor(judgement({ valid: false, bonusMatched: true }))).toBe(0);
  });

  it('scores a valid answer without bonus', () => {
    expect(pointsFor(judgement({ valid: true }))).toBe(SCORING.validAnswer);
  });

  it('scores a valid answer with bonus', () => {
    expect(pointsFor(judgement({ valid: true, bonusMatched: true }))).toBe(
      SCORING.validAnswerWithBonus
    );
  });
});

describe('scoreVerdict', () => {
  it('derives points, so a judge cannot invent a score', () => {
    const scored = scoreVerdict(
      verdict({
        name: judgement({ valid: true }),
        place: judgement({ valid: true, bonusMatched: true }),
      }),
      60
    );

    expect(scored.categories.name.points).toBe(10);
    expect(scored.categories.place.points).toBe(15);
    expect(scored.categories.animal.points).toBe(0);
    expect(scored.totalScore).toBe(25);
    expect(scored.speedBonus).toBe(0);
  });

  it('adds the speed bonus to the base score', () => {
    const allValid = Object.fromEntries(
      CATEGORY_KEYS.map((k) => [k, judgement({ valid: true, bonusMatched: true })])
    ) as Record<CategoryKey, CategoryJudgement>;

    const scored = scoreVerdict(verdict(allValid), 15);

    expect(scored.totalScore).toBe(15 * 4 + 20);
    expect(scored.speedBonus).toBe(20);
  });

  it('derives bonusChallengeMet from the threshold when the judge is silent', () => {
    const one = scoreVerdict(
      verdict({ name: judgement({ valid: true, bonusMatched: true }) }),
      60
    );
    expect(one.bonusChallengeMet).toBe(false);

    const two = scoreVerdict(
      verdict({
        name: judgement({ valid: true, bonusMatched: true }),
        place: judgement({ valid: true, bonusMatched: true }),
      }),
      60
    );
    expect(two.bonusChallengeMet).toBe(true);
  });

  it('respects a judge that is stricter than the threshold', () => {
    // A rule reading "all four answers" is not met by two, so a judge saying
    // false overrules the count.
    const scored = scoreVerdict(
      verdict(
        {
          name: judgement({ valid: true, bonusMatched: true }),
          place: judgement({ valid: true, bonusMatched: true }),
        },
        { bonusChallengeMet: false }
      ),
      60
    );

    expect(scored.bonusChallengeMet).toBe(false);
  });

  it('never lets a judge claim the challenge its own rulings contradict', () => {
    // Observed live: the model asserted a match while its own feedback said
    // otherwise. Both must agree.
    const scored = scoreVerdict(verdict({}, { bonusChallengeMet: true }), 60);

    expect(scored.bonusChallengeMet).toBe(false);
  });

  it('uses the judge’s own feedback when supplied', () => {
    const scored = scoreVerdict(verdict({}, { overallFeedback: 'Nice work' }), 60);

    expect(scored.overallFeedback).toBe('Nice work');
  });

  it('carries a suggestion through to the scored round', () => {
    const scored = scoreVerdict(
      verdict({ name: judgement({ valid: false, suggestion: 'Sarah' }) }),
      60
    );

    expect(scored.categories.name.suggestion).toBe('Sarah');
  });

  it('carries the judge identity through to the evaluation', () => {
    expect(scoreVerdict(verdict({}, { judgedBy: 'azure' }), 60).judgedBy).toBe('azure');
  });
});

describe('defaultOverallFeedback', () => {
  it('varies by how many categories were valid', () => {
    expect(defaultOverallFeedback(4)).toMatch(/Perfect score/);
    expect(defaultOverallFeedback(2)).toMatch(/Good effort/);
    expect(defaultOverallFeedback(0)).toMatch(/Keep practicing/);
  });
});

describe('evaluateRound', () => {
  it('scores whatever the judge returns', async () => {
    const scored = await evaluateRound(
      {
        letter: 'S',
        answers: { name: 'Sam', place: 'Spain', animal: 'Shark', thing: 'Spoon' },
        bonusChallenge: bonus,
        timeTakenSeconds: 10,
      },
      stubJudge(verdict({ name: judgement({ valid: true }) }))
    );

    // Only one of the four is valid, so the round earns its points and no
    // speed bonus, however fast it was submitted.
    expect(scored.totalScore).toBe(10);
    expect(scored.speedBonus).toBe(0);
  });

  it('never shows the judge the clock', async () => {
    let seen: unknown;
    const spy: Judge = {
      judge: async (request) => {
        seen = request;
        return verdict();
      },
    };

    await evaluateRound(
      {
        letter: 'S',
        answers: { name: '', place: '', animal: '', thing: '' },
        bonusChallenge: bonus,
        timeTakenSeconds: 5,
      },
      spy
    );

    expect(seen).not.toHaveProperty('timeTakenSeconds');
  });

  it('drops a suggestion that would not itself have scored', async () => {
    // Observed live: under H with a "double hh" rule, a rejected Name was
    // offered "Rhythm" — wrong letter, no double h, and not a name.
    const scored = await evaluateRound(
      {
        letter: 'H',
        answers: { name: 'Hhoney', place: 'Hong Kong', animal: '', thing: '' },
        bonusChallenge: {
          ...bonus,
          rule: { scope: 'all', checkKind: 'doubleLetter', checkValue: 'h' },
        },
        timeTakenSeconds: 10,
      },
      stubJudge(
        verdict({
          name: judgement({ valid: false, suggestion: 'Rhythm' }),
          place: judgement({ valid: false, suggestion: 'Hhampstead' }),
        })
      )
    );

    expect(scored.categories.name.suggestion).toBeUndefined();
    expect(scored.categories.place.suggestion).toBe('Hhampstead');
  });
});

describe('withFallback', () => {
  it('uses the primary judge when it succeeds', async () => {
    const judge = withFallback(
      stubJudge(verdict({}, { judgedBy: 'azure' })),
      stubJudge(verdict({}, { judgedBy: 'heuristic' }))
    );

    const result = await judge.judge({
      letter: 'S',
      answers: { name: '', place: '', animal: '', thing: '' },
      bonusChallenge: bonus,
    });

    expect(result.judgedBy).toBe('azure');
  });

  it('falls back and reports the fallback as the judge', async () => {
    const failing: Judge = {
      judge: async () => {
        throw new Error('primary judge exploded');
      },
    };

    const judge = withFallback(failing, stubJudge(verdict({}, { judgedBy: 'heuristic' })));

    const result = await judge.judge({
      letter: 'S',
      answers: { name: '', place: '', animal: '', thing: '' },
      bonusChallenge: bonus,
    });

    expect(result.judgedBy).toBe('heuristic');
  });
});

/**
 * The speed bonus rewards answering a round well, quickly — not merely
 * submitting quickly. Four blank answers used to score 20 points.
 */
describe('the speed bonus and a wrong answer', () => {
  const fast = 15;

  function allWith(overrides: Partial<CategoryJudgement>) {
    return Object.fromEntries(
      CATEGORY_KEYS.map((k) => [k, judgement({ valid: true, ...overrides })])
    ) as Record<CategoryKey, CategoryJudgement>;
  }

  it('withholds the speed bonus when one answer is wrong', () => {
    const scored = scoreVerdict(
      verdict({ ...allWith({}), animal: judgement({ valid: false }) }),
      fast
    );

    expect(scored.speedBonus).toBe(0);
    expect(scored.totalScore).toBe(30);
  });

  it('gives an empty round nothing at all', () => {
    const scored = scoreVerdict(
      verdict(
        Object.fromEntries(
          CATEGORY_KEYS.map((k) => [k, judgement({ valid: false })])
        ) as Record<CategoryKey, CategoryJudgement>
      ),
      fast
    );

    expect(scored.speedBonus).toBe(0);
    expect(scored.totalScore).toBe(0);
  });

  it('still rewards four right answers that miss the bonus', () => {
    const scored = scoreVerdict(verdict(allWith({ bonusMatched: false })), fast);

    expect(scored.speedBonus).toBe(20);
    expect(scored.totalScore).toBe(10 * 4 + 20);
  });

  it('rewards a round that is right but slow with nothing extra', () => {
    const scored = scoreVerdict(verdict(allWith({ bonusMatched: false })), 60);

    expect(scored.speedBonus).toBe(0);
    expect(scored.totalScore).toBe(40);
  });
});
