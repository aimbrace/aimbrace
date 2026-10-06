import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'plugins/*/test/**/*.test.ts',
      'examples/*/test/**/*.test.ts',
    ],
    environment: 'node',
    passWithNoTests: true,
    testTimeout: 10_000,
  },
})
