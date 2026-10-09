import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const docs = join(root, 'docs')
const pages = readdirSync(docs).filter((name) => name.endsWith('.md'))
const read = (name: string) => readFileSync(join(docs, name), 'utf8')
const markdown = [
  ...pages.map((name) => ({ name, text: read(name) })),
  { name: '../README.md', text: readFileSync(join(root, 'README.md'), 'utf8') },
]

/** `cordis` as installed for the templates, so the snippets run against the version the templates pin. */
const cordis = pathToFileURL(
  createRequire(join(root, 'packages', 'cli', 'package.json')).resolve('@deepseek-ai/cordis'),
).href

describe('docs', () => {
  it('links every page from the index', () => {
    const index = read('README.md')
    for (const page of pages.filter((name) => name !== 'README.md'))
      expect(index).toContain(`(${page})`)
  })

  it('has no broken relative links', () => {
    for (const { name, text } of markdown) {
      for (const [, target] of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        if (/^[a-z]+:/.test(target as string)) continue
        expect(
          () => readFileSync(resolve(docs, dirname(name), target as string)),
          `${name} -> ${target}`,
        ).not.toThrow()
      }
    }
  })

  it('mentions none of the removed runtime', () => {
    for (const { name, text } of markdown) {
      expect(text, name).not.toMatch(
        /@aimbrace\/|hookable|unplugin|effect-ts|definePlugin|createApp\(\{ plugins/i,
      )
      expect(text, name).not.toContain(String.fromCharCode(0x2014)) // no em dash
    }
  })
})

describe('docs: Cordis examples run', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'aimbrace-docs-'))
  afterAll(() => rmSync(scratch, { recursive: true, force: true }))
  const snippets = [...read('cordis.md').matchAll(/```js\n([\s\S]*?)```/g)].map(
    (match) => match[1] as string,
  )

  it('has examples', () => expect(snippets.length).toBeGreaterThanOrEqual(6))

  it.each(snippets.map((code, index) => [index + 1, code] as const))(
    'example %i',
    async (index, code) => {
      const file = join(scratch, `example-${index}.mjs`)
      writeFileSync(file, code.replaceAll("from '@deepseek-ai/cordis'", `from '${cordis}'`))
      await import(pathToFileURL(file).href)
    },
  )
})
