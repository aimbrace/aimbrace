import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { compose, loadManifest, lock, ManifestError, validate } from '../index.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function file(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-test-'))
  dirs.push(dir)
  const path = join(dir, 'aimbrace.yaml')
  writeFileSync(path, text)
  return path
}

const GOOD = `apiVersion: aimbrace/v1
kind: App
metadata: { name: shop, version: 1.0.0 }
parameters:
  greeting: { type: string, default: hello }
  port: { type: number, default: 3000 }
plugins:
  - id: greeter
    config: { text: "{{parameters.greeting}}, world", port: "{{parameters.port}}" }
  - id: second-greeter
    use: greeter
    disabled: true
`

test('resolves parameters: a whole token keeps its type, an embedded one renders as text', () => {
  const manifest = loadManifest(file(GOOD), { known: ['greeter'], values: { greeting: 'hi' } })
  assert.deepEqual(manifest.plugins[0], {
    id: 'greeter',
    use: 'greeter',
    config: { text: 'hi, world', port: 3000 },
  })
  assert.equal(manifest.plugins[1]?.use, 'greeter')
  assert.match(manifest.digest, /^[0-9a-f]{64}$/)
})

test('reports every problem with a path and a code, never a bare "invalid"', () => {
  const problems = validate(
    {
      apiVersion: 'aimbrace/v1',
      kind: 'App',
      metadata: { name: 'Shop', version: '1' },
      parameters: {
        unused: { type: 'string', default: 'x' },
        wrong: { type: 'number', default: 'nope' },
      },
      plugins: [
        { id: 'a', config: { x: '{{parameters.missing}} {{parameters.wrong}}' } },
        { id: 'a', use: 'ghost', extra: 1 },
      ],
      surprise: true,
    },
    ['a'],
  ).map((d) => `${d.code} ${d.path}`)
  assert.deepEqual(problems.sort(), [
    'dangling-parameter-reference plugins[0].config.x',
    'duplicate-row-id plugins[1].id',
    'parameter-type-mismatch parameters.wrong.default',
    'schema-error metadata.name',
    'schema-error plugins[1].extra',
    'schema-error surprise',
    'unknown-plugin plugins[1].use',
    'unused-parameter parameters.unused',
  ])
})

test('loadManifest throws every diagnostic at once, including a bad override', () => {
  assert.throws(
    () =>
      loadManifest(file(GOOD), {
        known: ['greeter'],
        values: { port: 'eighty' as never, nothing: 1 },
      }),
    (error: unknown) =>
      error instanceof ManifestError &&
      error.diagnostics
        .map((d) => d.code)
        .sort()
        .join() === 'parameter-override-unknown,parameter-type-mismatch',
  )
  assert.throws(() => loadManifest(file('kind: [unclosed')), /parse-error|not a valid app manifest/)
})

test('compose mounts enabled rows in order with their config, and runtime overrides win', async () => {
  const seen: Array<[string, unknown]> = []
  const greeter = {
    name: 'greeter',
    apply: (_: Context, config: unknown) => void seen.push(['greeter', config]),
  }
  const manifest = loadManifest(file(GOOD), { known: ['greeter'] })
  const root = new Context()
  const fibers = await compose(root, manifest, { greeter }, { greeter: { port: 0 } })
  assert.equal(fibers.length, 1)
  assert.deepEqual(seen, [['greeter', { text: 'hello, world', port: 0 }]])
  for (const fiber of fibers) await fiber.dispose()
})

test('the lock records the manifest digest, resolved values, rows and source digests', () => {
  const manifest = loadManifest(file(GOOD), { known: ['greeter'] })
  const locked = lock(manifest, { greeter: 'abc', apple: 'def' })
  assert.equal(locked.manifest.digest, `sha256:${manifest.digest}`)
  assert.deepEqual(locked.plugins, [
    { id: 'greeter', use: 'greeter', disabled: false },
    { id: 'second-greeter', use: 'greeter', disabled: true },
  ])
  assert.deepEqual(Object.keys(locked.sources), ['apple', 'greeter'])
})
