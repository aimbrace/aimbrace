import { assert, assertStringIncludes } from '@std/assert'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const docs = join(root, 'docs')
const pages: string[] = []
for await (const entry of Deno.readDir(docs)) if (entry.name.endsWith('.md')) pages.push(entry.name)
const read = (path: string) => Deno.readTextFileSync(path)
const markdown = [
  ...pages.map((name) => ({ path: join(docs, name), text: read(join(docs, name)) })),
  { path: join(root, 'README.md'), text: read(join(root, 'README.md')) },
]

Deno.test('the index links every page', () => {
  const index = read(join(docs, 'README.md'))
  for (const page of pages.filter((name) => name !== 'README.md')) {
    assertStringIncludes(index, `(${page})`)
  }
})

Deno.test('relative links resolve', () => {
  for (const { path, text } of markdown) {
    for (const [, target] of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/.test(target as string)) continue
      const file = resolve(dirname(path), target as string)
      assert(Deno.statSync(file), `${path} links to ${target}`)
    }
  }
})

Deno.test('no page mentions the removed runtime or uses an em dash', () => {
  for (const { path, text } of markdown) {
    assert(
      !/@aimbrace\/|hookable|unplugin|effect-ts|definePlugin|vitest|pnpm/i.test(text),
      `${path} mentions removed tooling`,
    )
    assert(!text.includes(String.fromCharCode(0x2014)), `${path} has an em dash`)
  }
})

const examples = [...read(join(docs, 'cordis.md')).matchAll(/```ts\n([\s\S]*?)```/g)].map((
  match,
) => match[1] as string)

Deno.test('cordis.md has examples', () => assert(examples.length >= 6))

const scratch = await Deno.makeTempDir({ prefix: 'aimbrace-docs-' })
globalThis.addEventListener('unload', () => Deno.removeSync(scratch, { recursive: true }))

/** The same versions the templates pin, so the examples run against what users get. */
const config = JSON.parse(read(join(root, 'deno.json'))).imports as Record<string, string>

for (const [index, code] of examples.entries()) {
  Deno.test(`cordis.md example ${index + 1} runs`, async () => {
    const file = join(scratch, `example-${index + 1}.ts`)
    await Deno.writeTextFile(
      file,
      code.replaceAll("from '@deepseek-ai/cordis'", `from '${config['@deepseek-ai/cordis']}'`)
        .replaceAll("from '@std/assert'", `from '${config['@std/assert']}'`),
    )
    await import(`file://${file}`)
  })
}
