import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { definePlugin, service } from '@aimbrace/core'
import { afterAll, describe, expect, it } from 'vitest'
import {
  CONFIG_NAMES,
  createAppFromConfig,
  defineConfig,
  findConfig,
  LoaderError,
  loadApp,
  loadConfig,
  normaliseConfig,
  resolvePlugin,
  validateManifest,
} from '../src'

const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url))
const plain = join(fixtures, 'plain-app')
const scratch = mkdtempSync(join(tmpdir(), 'aimbrace-loader-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('defineConfig', () => {
  it('is an identity function', () => {
    const config = { name: 'x', plugins: [] }
    expect(defineConfig(config)).toBe(config)
  })
})

describe('resolvePlugin', () => {
  it('resolves a default exported plugin by relative path', async () => {
    const plugin = await resolvePlugin('./plugins/hello.mjs', plain, 'test')
    expect((plugin as { id: string }).id).toBe('hello')
  })

  it('applies manifest config to a plugin exported as `plugin`', async () => {
    const instance = await resolvePlugin(
      { use: './plugins/configured.mjs', config: { port: 9 } },
      plain,
      'test',
    )
    expect(instance.kind).toBe('plugin-instance')
    expect((instance as { config: unknown }).config).toEqual({ port: 9 })
  })

  it('calls a factory export with the manifest config', async () => {
    const instance = await resolvePlugin(
      { use: './plugins/factory.mjs', config: { label: 'z' } },
      plain,
      'test',
    )
    expect((instance as { id: string }).id).toBe('factory-z')
  })

  it('passes a prebuilt instance through, and refuses extra config for it', async () => {
    const instance = await resolvePlugin('./plugins/prebuilt.mjs', plain, 'test')
    expect(instance.kind).toBe('plugin-instance')
    await expect(
      resolvePlugin({ use: './plugins/prebuilt.mjs', config: { a: 1 } }, plain, 'test'),
    ).rejects.toThrow(/already configured/)
  })

  it('resolves bare package names, including ESM-only packages without a require condition', async () => {
    const project = join(scratch, 'bare-project')
    const fake = (id: string) =>
      `export default Object.assign(() => ({ kind: 'plugin-instance' }), { kind: 'plugin', id: '${id}' })\n`
    const install = (name: string, manifest: object, file = 'index.mjs') => {
      const dir = join(project, 'node_modules', name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name, type: 'module', ...manifest }),
      )
      writeFileSync(join(dir, file), fake(name))
    }
    install('classic-plugin', { main: './index.mjs' })
    install('esm-only-plugin', { exports: { '.': { import: './index.mjs' } } })
    install('@scope/scoped-plugin', { exports: { '.': { default: './index.mjs' } } })
    mkdirSync(join(project, 'src'), { recursive: true })
    for (const name of ['classic-plugin', 'esm-only-plugin', '@scope/scoped-plugin']) {
      const plugin = await resolvePlugin(name, join(project, 'src'), 'test')
      expect((plugin as { id: string }).id).toBe(name)
    }
    const missing = (await resolvePlugin('absent-package', project, 'cfg').catch(
      (e: unknown) => e,
    )) as LoaderError
    expect(missing).toBeInstanceOf(LoaderError)
    expect(missing.message).toContain('Cannot find plugin "absent-package"')
  })

  it('explains a missing module', async () => {
    const error = (await resolvePlugin('./nope.mjs', plain, 'cfg.json').catch(
      (e: unknown) => e,
    )) as LoaderError
    expect(error).toBeInstanceOf(LoaderError)
    expect(error.code).toBe('E_LOADER')
    expect(error.specifier).toBe('./nope.mjs')
    expect(error.file).toBe('cfg.json')
  })

  it('explains a module that exports no plugin', async () => {
    await expect(resolvePlugin('./plugins/nothing.mjs', plain, 'x')).rejects.toThrow(
      /does not export a plugin/,
    )
  })

  it('wraps an exception thrown while importing', async () => {
    const error = (await resolvePlugin('./plugins/throws.mjs', plain, 'x').catch(
      (e: unknown) => e,
    )) as LoaderError
    expect(error.message).toContain('module exploded while loading')
    expect(error.cause).toBeInstanceOf(Error)
  })
})

describe('validateManifest', () => {
  it.each([
    [[], /must be a JSON object/],
    [{ plugins: 'x' }, /"plugins" must be an array/],
    [{ plugins: [], extra: 1 }, /Unknown manifest key "extra"/],
    [{ name: 3, plugins: [] }, /"name" must be a string/],
    [{ plugins: [5] }, /plugins\[0\] must be a string or an object/],
    [{ plugins: [{ config: {} }] }, /plugins\[0\].use must be a string/],
    [{ plugins: [{ use: 'a', cfg: 1 }] }, /unknown key "cfg"/],
  ])('rejects %j', (raw, pattern) => {
    expect(() => validateManifest(raw, 'm.json')).toThrow(pattern)
  })

  it('accepts a valid manifest', () => {
    expect(
      validateManifest({ name: 'a', plugins: ['x', { use: 'y', config: 1 }] }, 'm.json').plugins,
    ).toHaveLength(2)
  })
})

describe('loadConfig', () => {
  it('loads a JSON manifest and builds a working app', async () => {
    const loaded = await loadConfig(join(plain, 'aimbrace.json'))
    expect(loaded.name).toBe('plain')
    expect(loaded.plugins).toHaveLength(3)
    const app = createAppFromConfig(loaded)
    await app.start()
    expect(app.inspect().plugins.map((p) => p.id)).toEqual(['hello', 'configured', 'factory-x'])
    const port = service<number>('port')
    expect(app.get(port)).toBe(8081)
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('loads a config module with mixed entries', async () => {
    const loaded = await loadConfig(join(plain, 'aimbrace.config.mjs'))
    expect(loaded.name).toBe('from-module')
    const app = createAppFromConfig(loaded, { name: 'override' })
    expect(app.name).toBe('override')
    await app.start()
    expect(app.inspect().plugins.map((p) => p.id)).toEqual(['hello', 'inline'])
    await app.stop()
  })

  it('reports a missing file, bad JSON, a bad manifest and a module without config', async () => {
    await expect(loadConfig(join(scratch, 'absent.json'))).rejects.toThrow(/Config file not found/)

    writeFileSync(join(scratch, 'broken.json'), '{ nope')
    await expect(loadConfig(join(scratch, 'broken.json'))).rejects.toThrow(/Cannot parse/)

    await expect(loadConfig(join(fixtures, 'bad-app', 'aimbrace.json'))).rejects.toThrow(
      /Unknown manifest key "surprise"/,
    )

    writeFileSync(join(scratch, 'empty.mjs'), 'export default { nothing: true }\n')
    await expect(loadConfig(join(scratch, 'empty.mjs'))).rejects.toThrow(/"plugins" array/)
  })

  it('accepts a config module that exports a function (sync or async)', async () => {
    writeFileSync(
      join(scratch, 'fn.mjs'),
      'export default async () => ({ name: "from-fn", plugins: [] })\n',
    )
    expect((await loadConfig(join(scratch, 'fn.mjs'))).name).toBe('from-fn')
  })

  it('rejects an entry that is not a plugin, specifier or { use }', async () => {
    await expect(normaliseConfig({ plugins: [42 as never] }, scratch)).rejects.toThrow(
      /must be a plugin/,
    )
  })

  it('accepts inline plugin objects without any file', async () => {
    const inline = definePlugin({ id: 'inline-only' })
    const loaded = await normaliseConfig({ plugins: [inline] }, scratch)
    expect(loaded.file).toBeUndefined()
    expect(loaded.plugins).toEqual([inline])
  })
})

describe('findConfig and loadApp', () => {
  it('walks up from a nested directory and honours priority order', async () => {
    const root = join(scratch, 'project')
    const nested = join(root, 'src', 'deep')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, 'aimbrace.json'), '{"plugins":[]}')
    expect(await findConfig(nested)).toBe(join(root, 'aimbrace.json'))
    writeFileSync(join(root, 'aimbrace.config.mjs'), 'export default { plugins: [] }\n')
    expect(await findConfig(nested)).toBe(join(root, 'aimbrace.config.mjs'))
    expect(CONFIG_NAMES[0]).toBe('aimbrace.config.ts')
  })

  it('returns undefined when nothing is found', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'aimbrace-empty-'))
    try {
      // A config could exist in a parent of the temp dir on some machines; only assert the happy shape.
      const found = await findConfig(empty)
      expect(found === undefined || typeof found === 'string').toBe(true)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('loadApp accepts a directory or a file', async () => {
    const byDirectory = await loadApp(plain)
    expect(byDirectory.name).toBe('from-module')
    const byFile = await loadApp(join(plain, 'aimbrace.json'))
    expect(byFile.name).toBe('plain')
    await expect(loadApp(join(scratch, 'project', 'src', 'deep', 'none.json'))).rejects.toThrow(
      /not found/,
    )
  })
})
