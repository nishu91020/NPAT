import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],

    exclude: mode === 'integration' ? [] : ['**/*.integration.test.ts', '**/node_modules/**'],
    env: {
      RUN_AZURITE_TESTS: mode === 'integration' ? 'true' : '',
    },
  },
}));
