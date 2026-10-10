import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { parse } from 'yaml'
import { compose, loadManifest, lock, ManifestError, validate } from '../index.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function file(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-test-'))
  dirs.push(dir)
  const path = join(dir, 'blend.yaml')
  writeFileSync(path, text)
  return path
}

const GOOD = `apiVersion: blends.acryl.dev/v1alpha1
kind: Blueprint
metadata: { id: aimbrace.shop, name: shop, version: 1.0.0 }
spec:
  runtime: cordis
  parameters:
    greeting: { type: string, default: hello }
    port: { type: number, default: 3000 }
  rows:
    - id: greeter
      name: greeter
      config: { text: "{{parameters.greeting}}, world", port: "{{parameters.port}}" }
    - id: second-greeter
      name: greeter
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
      apiVersion: 'blends.acryl.dev/v1alpha1',
      kind: 'Blueprint',
      metadata: { id: 'Shop', name: '', version: '1', surprise: 1 },
      spec: {
        runtime: 'cordis',
        parameters: {
          unused: { type: 'string', default: 'x' },
          wrong: { type: 'number', default: 'nope' },
          described: { type: 'string', default: 'x', description: 'not in the format' },
        },
        rows: [
          {
            id: 'a',
            name: 'a',
            config: { x: '{{parameters.missing}} {{parameters.wrong}} {{parameters.described}}' },
          },
          { id: 'a', name: 'ghost', extra: 1 },
        ],
      },
      extra: true,
    },
    ['a'],
  ).map((d) => `${d.code} ${d.path}`)
  assert.deepEqual(problems.sort(), [
    'dangling-parameter-reference spec.rows[0].config.x',
    'duplicate-row-id spec.rows[1].id',
    'parameter-type-mismatch spec.parameters.wrong.default',
    'schema-error extra',
    'schema-error metadata.id',
    'schema-error metadata.name',
    'schema-error metadata.surprise',
    'schema-error metadata.version',
    'schema-error spec.parameters.described.description',
    'schema-error spec.rows[1].extra',
    'unknown-plugin spec.rows[1].name',
    'unused-parameter spec.parameters.unused',
  ])
})

test('inheritance is part of the Blend format but not read yet: it is reported as unsupported, not ignored', () => {
  const base = {
    apiVersion: 'blends.acryl.dev/v1alpha1',
    metadata: { id: 'aimbrace.shop', name: 'shop', version: '1.0.0' },
  }
  const problems = validate({
    ...base,
    kind: 'Blend',
    spec: {
      runtime: 'cordis',
      extends: 'acryl.blank',
      lineage: { blueprint: 'acryl.blank', blueprintVersion: '1.0.0' },
      overrides: [],
    },
  }).map((d) => `${d.code} ${d.path}`)
  assert.deepEqual(problems.sort(), [
    'unsupported kind',
    'unsupported spec.extends',
    'unsupported spec.lineage',
    'unsupported spec.overrides',
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

/** The proof that a manifest is a Blend: ACRYL's own JSON schema (copied from runtime/blends-core, MIT) accepts it. */
const schema = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./blend-manifest.v1alpha1.schema.json', import.meta.url)),
    'utf8',
  ),
)
const accepts = new Ajv2020({ allErrors: true }).compile(schema)

test("a manifest this plugin accepts is a valid ACRYL blend.yaml: the test fixture and both templates pass ACRYL's schema", () => {
  assert.equal(accepts(parse(GOOD)), true, JSON.stringify(accepts.errors))
  const templates = fileURLToPath(new URL('../../../packages/cli/templates/', import.meta.url))
  for (const template of readdirSync(templates)) {
    const text = readFileSync(join(templates, template, 'blend.yaml'), 'utf8').replaceAll(
      '__APP_NAME__',
      'my-app',
    )
    const document = parse(text)
    assert.equal(accepts(document), true, `${template}: ${JSON.stringify(accepts.errors)}`)
    assert.deepEqual(validate(document), [], template)
  }
})

test('and the schema rejects what this plugin rejects, so the two agree on a document with an unknown field', () => {
  const document = parse(GOOD)
  document.spec.parameters.greeting.description = 'not allowed'
  assert.equal(accepts(document), false)
  assert.ok(
    validate(document, ['greeter']).some((d) => d.path === 'spec.parameters.greeting.description'),
  )
})
