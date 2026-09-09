/**
 * Unit tests — pure-function tests that need no server, database or browser.
 * Run with: npm run test:unit
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    testTimeout: 5000,
  },
});
