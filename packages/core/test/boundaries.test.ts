import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcDir = fileURLToPath(new URL('../src', import.meta.url))
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { dependencies?: Record<string, string> }

/** Runtime dependencies the core may have (constitution VII). */
const ALLOWED_DEPENDENCIES = ['cordis', 'hookable']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  )
}

function specifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const found = new Set<string>()
  for (const match of text.matchAll(/(?:import|export)[^'"`]*?from\s+['"]([^'"]+)['"]/g)) {
    found.add(match[1] as string)
  }
  for (const match of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    found.add(match[1] as string)
  }
  return [...found]
}

describe('core boundaries (constitution I and VII)', () => {
  const files = sourceFiles(srcDir)

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it('imports only relative modules or the allowed runtime dependencies', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const specifier of specifiers(file)) {
        const relative = specifier.startsWith('.')
        const allowed = ALLOWED_DEPENDENCIES.includes(specifier)
        if (!relative && !allowed) offenders.push(`${file}: ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('imports no Node-only module', () => {
    const offenders = files.flatMap((file) =>
      specifiers(file)
        .filter((specifier) => specifier.startsWith('node:'))
        .map((specifier) => `${file}: ${specifier}`),
    )
    expect(offenders).toEqual([])
  })

  it('declares only the allowed runtime dependencies', () => {
    const declared = Object.keys(manifest.dependencies ?? {})
    expect(declared.filter((name) => !ALLOWED_DEPENDENCIES.includes(name))).toEqual([])
  })

  it('imports cordis only inside src/internal/cordis.ts', () => {
    const offenders = files
      .filter((file) => !file.endsWith(join('internal', 'cordis.ts')))
      .filter((file) => specifiers(file).includes('cordis'))
    expect(offenders).toEqual([])
    const wrapper = files.find((file) => file.endsWith(join('internal', 'cordis.ts')))
    expect(wrapper && specifiers(wrapper)).toContain('cordis')
  })

  it('knows nothing about hosts or vendors', () => {
    const forbidden = /\b(openai|anthropic|postgres|react|next\.js|fastify|hono|express)\b/i
    const offenders = files.filter((file) => forbidden.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
