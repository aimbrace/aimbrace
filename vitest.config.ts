import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

/** Map every workspace package to its source entry so tests run without building. */
function workspaceAliases(): Record<string, string> {
  const aliases: Record<string, string> = {}
  for (const group of ['packages', 'plugins']) {
    const base = `${root}${group}`
    if (!existsSync(base)) continue
    for (const dir of readdirSync(base)) {
      const entry = `${base}/${dir}/src/index.ts`
      if (!existsSync(entry)) continue
      const name = group === 'plugins' ? `@aimbrace/plugin-${dir}` : `@aimbrace/${dir}`
      aliases[name] = entry
    }
  }
  return aliases
}

export default defineConfig({
  resolve: { alias: workspaceAliases() },
  test: {
    // Examples are integration tests of the built packages: see vitest.examples.config.ts.
    include: ['packages/*/test/**/*.test.ts', 'plugins/*/test/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
    testTimeout: 10_000,
  },
})
