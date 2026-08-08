import { describe, expect, it } from 'vitest';
import { AZURE_ENV_VARS, resolveAzureConfig } from './config';

const complete = {
  AZURE_OPENAI_ENDPOINT: 'https://my-resource.openai.azure.com',
  AZURE_OPENAI_API_KEY: 'secret-key',
  AZURE_OPENAI_JUDGE_DEPLOYMENT: 'npat-judge',
  AZURE_OPENAI_BONUS_DEPLOYMENT: 'npat-bonus',
};

describe('resolveAzureConfig', () => {
  it('reports "unconfigured" when nothing is set, so the app runs heuristic-only', () => {
    expect(resolveAzureConfig({})).toEqual({ kind: 'unconfigured' });
  });

  it('treats blank and whitespace-only values as absent', () => {
    const blank = { ...complete, AZURE_OPENAI_API_KEY: '   ' };
    const result = resolveAzureConfig(blank);

    expect(result.kind).toBe('incomplete');
    if (result.kind === 'incomplete') {
      expect(result.missing).toEqual(['AZURE_OPENAI_API_KEY']);
    }
  });

  it('ignores unrelated environment variables', () => {
    expect(resolveAzureConfig({ PATH: '/usr/bin', NODE_ENV: 'test' })).toEqual({
      kind: 'unconfigured',
    });
  });

  it('resolves a complete configuration', () => {
    const result = resolveAzureConfig(complete);

    expect(result).toEqual({
      kind: 'configured',
      endpoint: 'https://my-resource.openai.azure.com',
      apiKey: 'secret-key',
      judgeDeployment: 'npat-judge',
      bonusDeployment: 'npat-bonus',
    });
  });

  it('trims surrounding whitespace, which survives copy-paste from a portal', () => {
    const padded = {
      ...complete,
      AZURE_OPENAI_ENDPOINT: '  https://my-resource.openai.azure.com  ',
    };
    const result = resolveAzureConfig(padded);

    expect(result.kind).toBe('configured');
    if (result.kind === 'configured') {
      expect(result.endpoint).toBe('https://my-resource.openai.azure.com');
    }
  });

  it('strips a trailing slash so the base URL never doubles up', () => {
    const result = resolveAzureConfig({
      ...complete,
      AZURE_OPENAI_ENDPOINT: 'https://my-resource.openai.azure.com/',
    });

    expect(result.kind).toBe('configured');
    if (result.kind === 'configured') {
      expect(result.endpoint).toBe('https://my-resource.openai.azure.com');
    }
  });

  describe('partial configuration is an error, not a silent downgrade', () => {
    it.each(AZURE_ENV_VARS)('reports %s when it alone is missing', (missingVar) => {
      const partial = { ...complete };
      delete (partial as Record<string, string>)[missingVar];

      const result = resolveAzureConfig(partial);

      expect(result.kind).toBe('incomplete');
      if (result.kind === 'incomplete') {
        expect(result.missing).toEqual([missingVar]);
      }
    });

    it('lists every missing variable, not just the first', () => {
      const result = resolveAzureConfig({
        AZURE_OPENAI_ENDPOINT: complete.AZURE_OPENAI_ENDPOINT,
      });

      expect(result.kind).toBe('incomplete');
      if (result.kind === 'incomplete') {
        expect(result.missing).toEqual([
          'AZURE_OPENAI_API_KEY',
          'AZURE_OPENAI_JUDGE_DEPLOYMENT',
          'AZURE_OPENAI_BONUS_DEPLOYMENT',
        ]);
      }
    });
  });
});
