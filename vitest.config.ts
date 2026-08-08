import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// fileURLToPath rather than URL.pathname, which yields "/C:/..." on Windows.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Deliberately no plugins. Loading vite.config.ts would pull in
// @tailwindcss/vite, which fails in Vitest's node environment, and the React
// plugin is irrelevant for these pure-module tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts', 'src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': rootDir,
    },
  },
});
