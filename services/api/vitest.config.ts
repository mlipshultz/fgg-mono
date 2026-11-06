import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Fixtures describe shows in October 2026; pin the clock before them so "upcoming" stays true.
    setupFiles: ['./test/setup.ts'],
  },
});
