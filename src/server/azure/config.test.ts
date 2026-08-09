import { describe, expect, it } from 'vitest';
import { AZURE_ENV_VARS, resolveAzureConfig } from './config';

const complete = {
  AZURE_OPENAI_ENDPOINT: 'https://my-resource.openai.azure.com',
  AZURE_OPENAI_JUDGE_DEPLOYMENT: 'npat-judge',
  AZURE_OPENAI_BONUS_DEPLOYMENT: 'npat-bonus',
};

describe('resolveAzureConfig', () => {
  it('reports "unconfigured" when nothing is set, so the app runs heuristic-only', () => {
    expect(resolveAzureConfig({})).toEqual({ kind: 'unconfigured' });
  });

  it('requires no credential, since Entra ID supplies it at call time', () => {
    const result = resolveAzureConfig(complete);

    expect(result.kind).toBe('configured');
    expect(JSON.stringify(result)).not.toMatch(/key|secret|password/i);
  });

  it('treats blank and whitespace-only values as absent', () => {
    const blank = { ...complete, AZURE_OPENAI_JUDGE_DEPLOYMENT: '   ' };
    const result = resolveAzureConfig(blank);

    expect(result.kind).toBe('incomplete');
    if (result.kind === 'incomplete') {
      expect(result.missing).toEqual(['AZURE_OPENAI_JUDGE_DEPLOYMENT']);
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
      endpoint: 'https://my-resource.openai.azure.com/openai/v1',
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
      expect(result.endpoint).toBe('https://my-resource.openai.azure.com/openai/v1');
    }
  });

  it('strips a trailing slash so the base URL never doubles up', () => {
    const result = resolveAzureConfig({
      ...complete,
      AZURE_OPENAI_ENDPOINT: 'https://my-resource.openai.azure.com/',
    });

    expect(result.kind).toBe('configured');
    if (result.kind === 'configured') {
      expect(result.endpoint).toBe('https://my-resource.openai.azure.com/openai/v1');
    }
  });

  describe('endpoint normalisation accepts whatever the portal shows', () => {
    // The portal's own sample includes the /openai/v1 suffix, and newer
    // resources use services.ai.azure.com rather than openai.azure.com.
    const expected = 'https://example-resource.services.ai.azure.com/openai/v1';

    it.each([
      ['bare resource host', 'https://example-resource.services.ai.azure.com'],
      ['with the portal suffix', 'https://example-resource.services.ai.azure.com/openai/v1'],
      ['with a trailing slash', 'https://example-resource.services.ai.azure.com/openai/v1/'],
      ['with just /openai', 'https://example-resource.services.ai.azure.com/openai'],
    ])('normalises %s', (_label, endpoint) => {
      const result = resolveAzureConfig({ ...complete, AZURE_OPENAI_ENDPOINT: endpoint });

      expect(result.kind).toBe('configured');
      if (result.kind === 'configured') {
        expect(result.endpoint).toBe(expected);
      }
    });

    it('never doubles the path, whichever form was pasted in', () => {
      for (const endpoint of [
        'https://x.services.ai.azure.com',
        'https://x.services.ai.azure.com/openai/v1',
      ]) {
        const result = resolveAzureConfig({ ...complete, AZURE_OPENAI_ENDPOINT: endpoint });
        if (result.kind === 'configured') {
          expect(result.endpoint).not.toContain('/openai/v1/openai');
          expect(result.endpoint.match(/\/openai\/v1/g)).toHaveLength(1);
        }
      }
    });

    it('supports the older openai.azure.com host too', () => {
      const result = resolveAzureConfig({
        ...complete,
        AZURE_OPENAI_ENDPOINT: 'https://legacy.openai.azure.com',
      });

      expect(result.kind).toBe('configured');
      if (result.kind === 'configured') {
        expect(result.endpoint).toBe('https://legacy.openai.azure.com/openai/v1');
      }
    });
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
          'AZURE_OPENAI_JUDGE_DEPLOYMENT',
          'AZURE_OPENAI_BONUS_DEPLOYMENT',
        ]);
      }
    });
  });
});
