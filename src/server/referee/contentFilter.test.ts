import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { BonusChallenge } from '../../shared/contract';
import { harmCategoriesFrom, isContentFilterRejection } from '../azure/structuredCompletion';
import { createAzureJudge } from './azureJudge';
import {
  UNSCOREABLE,
  onlyCategory,
  unscoreableCategories,
  withoutCategories,
} from './contentFilter';

const bonus: BonusChallenge = {
  id: 'long_words',
  title: 'Super Size Words',
  description: 'All 4 answers must be at least 5 letters long.',
  icon: 'Sparkles',
  ruleHint: 'Words must contain 5+ letters.',
};

const request = {
  letter: 'S',
  answers: { name: 'Sarah', place: 'Spain', animal: 'Shark', thing: 'Slur' },
  bonusChallenge: bonus,
};

function contentFilterError() {
  return Object.assign(new Error('The response was filtered'), {
    status: 400,
    error: {
      code: 'content_filter',
      innererror: {
        code: 'ResponsibleAIPolicyViolation',
        content_filter_result: {
          hate: { filtered: true, severity: 'medium' },
          violence: { filtered: false, severity: 'safe' },
        },
      },
    },
  });
}

function verdictJson(feedback = 'Nice') {
  const category = { valid: true, bonusMatched: true, feedback };
  return JSON.stringify({
    categories: { name: category, place: category, animal: category, thing: category },
    overallFeedback: 'Well played',
    bonusChallengeMet: true,
  });
}

function ok(content = verdictJson()) {
  return { choices: [{ message: { content }, finish_reason: 'stop' }] };
}

describe('isContentFilterRejection', () => {
  it('recognises the documented rejection shape', () => {
    expect(isContentFilterRejection(contentFilterError())).toBe(true);
  });

  it('recognises a top-level code too', () => {
    expect(isContentFilterRejection({ status: 400, code: 'content_filter' })).toBe(true);
  });

  it('does not mistake other failures for filtering', () => {
    expect(isContentFilterRejection(new Error('boom'))).toBe(false);
    expect(isContentFilterRejection({ status: 429 })).toBe(false);
    expect(isContentFilterRejection({ status: 500 })).toBe(false);
    expect(isContentFilterRejection(undefined)).toBe(false);
  });
});

describe('harmCategoriesFrom', () => {
  it('reports only the categories that actually filtered', () => {
    expect(harmCategoriesFrom(contentFilterError())).toEqual(['hate']);
  });

  it('returns nothing when there is no filter detail', () => {
    expect(harmCategoriesFrom(new Error('boom'))).toEqual([]);
  });
});

describe('request narrowing', () => {
  it('onlyCategory keeps a single answer so a rejection can be attributed', () => {
    expect(onlyCategory(request, 'thing').answers).toEqual({
      name: '',
      place: '',
      animal: '',
      thing: 'Slur',
    });
  });

  it('withoutCategories blanks the blocked answers and keeps the rest', () => {
    expect(withoutCategories(request, new Set(['thing'])).answers).toEqual({
      name: 'Sarah',
      place: 'Spain',
      animal: 'Shark',
      thing: '',
    });
  });
});

describe('unscoreableCategories', () => {
  it('is empty for a normally judged round', () => {
    const ok = {
      valid: true,
      bonusMatched: false,
      feedback: 'Nice',
    };

    expect(
      unscoreableCategories({ name: ok, place: ok, animal: ok, thing: ok })
    ).toEqual([]);
  });

  it('does not mistake an ordinary rejection for a filtered one', () => {
    const rejected = {
      valid: false,
      bonusMatched: false,
      feedback: 'Must start with the letter "S".',
    };

    expect(
      unscoreableCategories({
        name: rejected,
        place: rejected,
        animal: rejected,
        thing: rejected,
      })
    ).toEqual([]);
  });

  it('names a category the filter refused to judge', () => {
    const ok = { valid: true, bonusMatched: false, feedback: 'Nice' };

    expect(
      unscoreableCategories({
        name: ok,
        place: ok,
        animal: ok,
        thing: { ...UNSCOREABLE },
      })
    ).toEqual(['thing']);
  });
});

describe('createAzureJudge with a filtered answer', () => {

  function filteringClient(banned: string) {
    const create = vi.fn(async (args: any) => {
      const prompt = args.messages.map((m: any) => m.content).join('\n');
      if (prompt.includes(banned)) throw contentFilterError();
      return ok();
    });

    return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
  }

  it('marks only the offending answer unscoreable and scores the rest', async () => {
    const { client } = filteringClient('Slur');

    const verdict = await createAzureJudge(client, 'npat-judge').judge(request);

    expect(verdict.categories.thing).toEqual(UNSCOREABLE);
    expect(verdict.categories.name.valid).toBe(true);
    expect(verdict.categories.place.valid).toBe(true);
    expect(verdict.categories.animal.valid).toBe(true);
  });

  it('still reports itself as the azure judge, not the heuristic', async () => {
    const { client } = filteringClient('Slur');

    const verdict = await createAzureJudge(client, 'npat-judge').judge(request);

    expect(verdict.judgedBy).toBe('azure');
  });

  it('speaks in the game voice and does not accuse the player', async () => {
    const { client } = filteringClient('Slur');

    const verdict = await createAzureJudge(client, 'npat-judge').judge(request);
    const feedback = verdict.categories.thing.feedback;

    expect(feedback).toBe("We couldn't check this one — try a different word.");
    expect(feedback).not.toMatch(/filter|400|policy|violation|inappropriate|offensive/i);
  });

  it('never repeats the original request unchanged', async () => {
    const { client, create } = filteringClient('Slur');

    await createAzureJudge(client, 'npat-judge').judge(request);

    const prompts = create.mock.calls.map((c: any[]) =>
      c[0].messages.map((m: any) => m.content).join('\n')
    );
    const full = prompts.filter(
      (p) => p.includes('Sarah') && p.includes('Spain') && p.includes('Shark') && p.includes('Slur')
    );

    expect(full).toHaveLength(1);
  });

  it('does not probe answers the player left empty', async () => {
    const sparse = {
      ...request,
      answers: { name: 'Sarah', place: '', animal: '', thing: 'Slur' },
    };
    const { client, create } = filteringClient('Slur');

    await createAzureJudge(client, 'npat-judge').judge(sparse);

    expect(create).toHaveBeenCalledTimes(4);
  });

  it('marks every answer unscoreable when the rejection is not the answers', async () => {

    const { client } = filteringClient('Super Size Words');

    const verdict = await createAzureJudge(client, 'npat-judge').judge(request);

    for (const key of ['name', 'place', 'animal', 'thing'] as const) {
      expect(verdict.categories[key]).toEqual(UNSCOREABLE);
    }
    expect(verdict.bonusChallengeMet).toBe(false);
    expect(verdict.overallFeedback).toMatch(/couldn't check this round/i);
  });

  it('handles a filtered response as well as a filtered prompt', async () => {
    let call = 0;
    const create = vi.fn(async () => {
      call++;
      if (call === 1) {
        return { choices: [{ message: { content: null }, finish_reason: 'content_filter' }] };
      }
      return ok();
    });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;

    const verdict = await createAzureJudge(client, 'npat-judge').judge(request);

    expect(verdict.categories.name).toEqual(UNSCOREABLE);
  });

  it('lets transient failures through so withFallback reaches the heuristic', async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error('Too Many Requests'), { status: 429 });
    });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;

    await expect(createAzureJudge(client, 'npat-judge').judge(request)).rejects.toThrow(
      /Too Many Requests/
    );
  });
});
