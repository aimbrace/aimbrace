import { defineConfig } from 'vitest/config'

/**
 * Examples run against the BUILT packages (`dist`), resolved through node_modules exactly as a user's
 * project would. Run `pnpm run build` first; `pnpm run check` does.
 */
export default defineConfig({
  test: {
    include: ['examples/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
})
