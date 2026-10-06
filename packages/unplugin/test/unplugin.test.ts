import { fileURLToPath } from 'node:url'
import { definePlugin, service } from '@aimbrace/core'
import { build as esbuild } from 'esbuild'
import { rolldown } from 'rolldown'
import { rollup } from 'rollup'
import { describe, expect, it } from 'vitest'
import { type AimbraceUnpluginOptions, loadGraph, unplugin } from '../src'

const entry = fileURLToPath(new URL('./fixtures/entry.mjs', import.meta.url))
const project = fileURLToPath(new URL('./fixtures/project', import.meta.url))

const Model = service<unknown>('model')
const Agent = service<unknown>('agent')
const valid = [
  definePlugin({ id: 'agent', version: '1.0.0', requires: [Model], provides: [Agent] }),
  definePlugin({ id: 'model-provider', provides: [Model] }),
]
const invalid = [definePlugin({ id: 'agent', requires: [Model] })]

interface Bundled {
  graph: { ok: boolean; order: string[]; nodes: Array<{ id: string }>; edges: unknown[] }
  mermaid: string
  order: string[]
  plugins: Array<{ id: string; version?: string }>
}

async function evaluate(code: string): Promise<Bundled> {
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  return (await import(/* @vite-ignore */ url)) as Bundled
}

type Bundler = (options: AimbraceUnpluginOptions, warnings?: string[]) => Promise<string>

const bundlers: Record<string, Bundler> = {
  async rollup(options, warnings) {
    const bundle = await rollup({
      input: entry,
      plugins: [unplugin.rollup(options)],
      onwarn: (warning) => void warnings?.push(warning.message),
    })
    const { output } = await bundle.generate({ format: 'esm' })
    await bundle.close()
    return (output[0] as { code: string }).code
  },
  async rolldown(options, warnings) {
    const bundle = await rolldown({
      input: entry,
      plugins: [unplugin.rolldown(options)],
      onLog: (_level, log) => void warnings?.push(log.message),
    })
    const { output } = await bundle.generate({ format: 'esm' })
    await bundle.close()
    return (output[0] as { code: string }).code
  },
  async esbuild(options, warnings) {
    const result = await esbuild({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'esm',
      logLevel: 'silent',
      plugins: [unplugin.esbuild(options)],
    })
    for (const warning of result.warnings) warnings?.push(warning.text)
    return (result.outputFiles[0] as { text: string }).text
  },
}

describe.each(Object.entries(bundlers))('unplugin under %s', (_name, bundle) => {
  it('serves the graph, mermaid and plugin list as virtual modules', async () => {
    const result = await evaluate(await bundle({ plugins: valid }))
    expect(result.graph.ok).toBe(true)
    expect(result.graph.order).toEqual(['model-provider', 'agent'])
    expect(result.order).toEqual(['model-provider', 'agent'])
    expect(result.plugins.map((p) => p.id)).toEqual(['agent', 'model-provider'])
    expect(result.plugins[0]?.version).toBe('1.0.0')
    expect(result.mermaid).toContain('flowchart TD')
    expect(result.mermaid).toContain('p_model_provider -->|model| p_agent')
  })

  it('reads the project config file when no plugins are given', async () => {
    const result = await evaluate(await bundle({ cwd: project }))
    expect(result.graph.order).toEqual(['openai-like', 'agent'])
  })

  it('fails the build on an invalid graph, naming the problem', async () => {
    await expect(bundle({ plugins: invalid })).rejects.toThrow(
      /Invalid AIMBRACE plugin graph[\s\S]*requires service "model"/,
    )
  })

  it('only warns when strict is false, and still serves the graph', async () => {
    const warnings: string[] = []
    const result = await evaluate(await bundle({ plugins: invalid, strict: false }, warnings))
    expect(result.graph.ok).toBe(false)
    expect(warnings.some((message) => message.includes('requires service "model"'))).toBe(true)
  })

  it('fails with a clear message when there is no config and no plugins', async () => {
    await expect(bundle({ cwd: '/' })).rejects.toThrow(/no aimbrace config found/)
  })
})

describe('loadGraph', () => {
  it('builds the graph from a config file and reports the file', async () => {
    const { graph, file } = await loadGraph({ cwd: project })
    expect(graph.ok).toBe(true)
    expect(file).toMatch(/aimbrace\.config\.mjs$/)
  })

  it('exposes one adapter per bundler from the same definition', () => {
    for (const name of [
      'vite',
      'rollup',
      'rolldown',
      'esbuild',
      'webpack',
      'rspack',
      'farm',
      'bun',
    ] as const) {
      expect(unplugin[name]).toBeDefined()
    }
    expect(unplugin.raw({}, { framework: 'rollup' } as never)).toMatchObject({ name: 'aimbrace' })
  })
})
