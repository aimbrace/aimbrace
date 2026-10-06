import { defineConfig } from 'vitest/config'

// Only the package's own tests. The copied templates ship their own tests, which must not run here.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
})
