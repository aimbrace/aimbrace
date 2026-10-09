import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The templates' own tests run inside each scaffolded project: see scripts/verify-scaffolder.mjs.
    include: ['packages/*/test/**/*.test.ts', 'docs/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
})
