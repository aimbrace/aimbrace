import { defineConfig } from 'vitest/config'

// Only this package's tests. The templates under ./templates ship their own tests, which must not run here.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
})
