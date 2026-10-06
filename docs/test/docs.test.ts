import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const docs = join(root, 'docs')
const generated = join(docs, '.generated')
const BRIEF = 'aimbrace_spec.md'

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.generated' || entry.name === 'test') return []
    const path = join(dir, entry.name)
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : []
  })
}

const pages = markdownFiles(docs).filter((file) => !file.endsWith(BRIEF))
const read = (file: string) => readFileSync(file, 'utf8')

/** GitHub-style heading slug. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

function headings(text: string): Set<string> {
  const found = new Set<string>()
  let inFence = false
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence
    const match = !inFence && /^#{1,6}\s+(.*)$/.exec(line)
    if (match) found.add(slug(match[1] as string))
  }
  return found
}

describe('docs: pages', () => {
  it('has the pages the spec promises', () => {
    const names = pages.map((page) => relative(docs, page))
    for (const expected of [
      'README.md',
      'status.md',
      'getting-started/installation.md',
      'getting-started/quickstart.md',
      'concepts/overview.md',
      'concepts/services-and-tokens.md',
      'concepts/plugins.md',
      'concepts/dependency-graph.md',
      'concepts/lifecycle.md',
      'concepts/scopes.md',
      'concepts/registries.md',
      'concepts/hooks.md',
      'concepts/isolation-and-nesting.md',
      'concepts/hosts.md',
      'guides/write-a-plugin.md',
      'guides/testing-plugins.md',
      'guides/http-hosts.md',
      'guides/effect-interop.md',
      'guides/build-time-graph.md',
      'guides/cli.md',
      'guides/config-and-loader.md',
      'guides/ai-agents.md',
      'guides/errors.md',
      'architecture/decisions.md',
      'architecture/comparison.md',
    ]) {
      expect(names, `missing docs page ${expected}`).toContain(expected)
    }
  })

  it('links every page from the index', () => {
    const index = read(join(docs, 'README.md'))
    const unlinked = pages
      .filter((page) => page !== join(docs, 'README.md'))
      .map((page) => relative(docs, page))
      .filter((name) => !index.includes(`](${name})`) && !index.includes(`](./${name})`))
    expect(unlinked).toEqual([])
  })

  it('uses no em dash (house rule)', () => {
    const offenders = [...pages, join(root, 'README.md')].filter((file) => read(file).includes('—'))
    expect(offenders.map((file) => relative(root, file))).toEqual([])
  })
})

describe('docs: links', () => {
  it('resolves every relative link and anchor', () => {
    const problems: string[] = []
    for (const page of [...pages, join(root, 'README.md')]) {
      const text = read(page).replace(/```[\s\S]*?```/g, '')
      for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const target = match[1] as string
        if (/^(https?:|mailto:)/.test(target)) continue
        const [path, anchor] = target.split('#') as [string, string | undefined]
        const file = path === '' ? page : resolve(dirname(page), path)
        if (!existsSync(file)) {
          problems.push(`${relative(root, page)}: ${target} (no such file)`)
          continue
        }
        if (anchor && file.endsWith('.md') && !headings(read(file)).has(anchor)) {
          problems.push(`${relative(root, page)}: ${target} (no such heading)`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})

interface Snippet {
  name: string
  code: string
}

function snippets(): Snippet[] {
  const found: Snippet[] = []
  for (const page of pages) {
    const text = read(page)
    let counter = 0
    for (const match of text.matchAll(/```ts docs-test\n([\s\S]*?)```/g)) {
      counter += 1
      found.push({
        name: `${relative(docs, page).replace(/[/.]/g, '-')}-${counter}`,
        code: match[1] as string,
      })
    }
  }
  return found
}

describe('docs: runnable snippets', () => {
  const all = snippets()

  it('finds snippets to run', () => {
    expect(all.length).toBeGreaterThanOrEqual(12)
  })

  rmSync(generated, { recursive: true, force: true })
  mkdirSync(generated, { recursive: true })
  for (const snippet of all) {
    it(snippet.name, async () => {
      const file = join(generated, `${snippet.name}.ts`)
      writeFileSync(file, snippet.code)
      await import(/* @vite-ignore */ pathToFileURL(file).href)
    })
  }
})

/** Every identifier that appears inside an inline code span (so `layerPlugin({ id })` mentions layerPlugin). */
function codeIdentifiers(markdown: string): Set<string> {
  const found = new Set<string>()
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, '')
  for (const span of withoutFences.matchAll(/`([^`\n]+)`/g)) {
    for (const word of (span[1] as string).matchAll(/[A-Za-z_$][\w$]*/g)) found.add(word[0])
  }
  return found
}

const REFERENCE: Record<string, { page: string; dist: string }> = {
  core: { page: 'reference/core.md', dist: 'packages/core/dist/index.js' },
  http: { page: 'reference/http.md', dist: 'packages/http/dist/index.js' },
  hono: { page: 'reference/hono.md', dist: 'packages/hono/dist/index.js' },
  fastify: { page: 'reference/fastify.md', dist: 'packages/fastify/dist/index.js' },
  effect: { page: 'reference/effect.md', dist: 'packages/effect/dist/index.js' },
  unplugin: { page: 'reference/unplugin.md', dist: 'packages/unplugin/dist/index.js' },
  loader: { page: 'reference/loader.md', dist: 'packages/loader/dist/index.js' },
  cli: { page: 'reference/cli.md', dist: 'packages/cli/dist/index.js' },
  testing: { page: 'reference/testing.md', dist: 'packages/testing/dist/index.js' },
  'plugin-model': { page: 'reference/plugins.md', dist: 'plugins/model/dist/index.js' },
  'plugin-memory': { page: 'reference/plugins.md', dist: 'plugins/memory/dist/index.js' },
  'plugin-tools': { page: 'reference/plugins.md', dist: 'plugins/tools/dist/index.js' },
  'plugin-agent': { page: 'reference/plugins.md', dist: 'plugins/agent/dist/index.js' },
}

describe('docs: reference completeness', () => {
  const built = Object.values(REFERENCE).every((entry) => existsSync(join(root, entry.dist)))
  for (const [name, entry] of Object.entries(REFERENCE)) {
    it.skipIf(!built)(`documents every runtime export of ${name}`, async () => {
      const mod = (await import(
        /* @vite-ignore */ pathToFileURL(join(root, entry.dist)).href
      )) as Record<string, unknown>
      const mentioned = codeIdentifiers(read(join(docs, entry.page)))
      const missing = Object.keys(mod)
        .filter((key) => key !== 'default')
        .filter((key) => !mentioned.has(key))
      expect(missing, `${entry.page} does not mention: ${missing.join(', ')}`).toEqual([])
    })
  }
})

describe('docs: error catalogue', () => {
  it('lists every error code defined in the sources', () => {
    const codes = new Set<string>()
    const scan = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'test')
            scan(path)
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
          for (const match of read(path).matchAll(/'(E_[A-Z_]+)'/g)) codes.add(match[1] as string)
        }
      }
    }
    for (const group of ['packages', 'plugins']) {
      for (const name of readdirSync(join(root, group))) {
        const src = join(root, group, name, 'src')
        if (existsSync(src)) scan(src)
      }
    }
    expect(codes.size).toBeGreaterThan(20)
    const catalogue = read(join(docs, 'guides', 'errors.md'))
    const missing = [...codes].filter((code) => !catalogue.includes(`\`${code}\``))
    expect(missing).toEqual([])
  })
})
