import { defineConfig } from 'vitest/config';

// Deliberately no plugins. Loading vite.config.ts would pull in
// @tailwindcss/vite, which fails in Vitest's node environment, and the React
// plugin is irrelevant for these pure-module tests.
export default defineConfig(({ mode }) => ({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts', 'client/**/*.test.ts', 'shared/**/*.test.ts'],
    // Integration tests need Azurite running; excluded from the default run.
    exclude: mode === 'integration' ? [] : ['**/*.integration.test.ts', '**/node_modules/**'],
    env: {
      RUN_AZURITE_TESTS: mode === 'integration' ? 'true' : '',
    },
  },
}));
