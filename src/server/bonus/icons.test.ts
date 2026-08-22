import { describe, expect, it } from 'vitest';
import { BONUS_CHALLENGES } from '../../shared/bonusChallenges';
import { RENDERABLE_ICONS } from './icons';

describe('RENDERABLE_ICONS', () => {
  it('covers every icon the built-in challenges ask for', () => {
    for (const challenge of BONUS_CHALLENGES) {
      expect(RENDERABLE_ICONS, challenge.id).toContain(challenge.icon);
    }
  });

  it('has no duplicates, since it is offered to the model as an enum', () => {
    expect(new Set(RENDERABLE_ICONS).size).toBe(RENDERABLE_ICONS.length);
  });
});
