import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['main/tests/**/*.test.ts', 'main/src/**/*.test.ts', 'main/scripts/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
