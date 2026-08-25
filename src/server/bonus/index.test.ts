import { describe, expect, it } from 'vitest';
import * as bonusExports from './index';

describe('bonus index', () => {
  it('re-exports the runtime bonus API', () => {
    expect(bonusExports.cachedPerDate).toBeTypeOf('function');
    expect(bonusExports.createBlobStore).toBeTypeOf('function');
    expect(bonusExports.randomBuiltinSource).toBeDefined();
    expect(bonusExports.deterministicSourceForDate).toBeTypeOf('function');
    expect(bonusExports.RENDERABLE_ICONS).toBeDefined();
    expect(bonusExports.createAzureBonusSource).toBeTypeOf('function');
    expect(bonusExports.RULE_FAMILIES).toBeDefined();
  });
});
