import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Synthesizing a stack takes a second or two; give CI runners room.
    testTimeout: 30_000,
  },
});
