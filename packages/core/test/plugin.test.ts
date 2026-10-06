import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  AimbraceError,
  definePlugin,
  isPlugin,
  isPluginInstance,
  type PluginLike,
  resolvePluginLike,
  type StandardSchemaV1,
  service,
  type ValueOf,
} from '../src'

interface Model {
  complete(prompt: string): string
}
interface Memory {
  recall(): string[]
}
interface Tracing {
  span(name: string): void
}
interface AgentRuntime {
  run(): void
}

const Model = service<Model>('model')
const Memory = service<Memory>('memory')
const Tracing = service<Tracing>('tracing')
const Agent = service<AgentRuntime>('agent')

describe('definePlugin metadata', () => {
  const agent = definePlugin({
    id: 'agent',
    version: '1.2.0',
    description: 'runs agents',
    requires: [Model, Memory],
    optional: [Tracing],
    provides: [Agent],
    peers: { logger: '^1.0.0' },
  })

  it('exposes plain metadata', () => {
    expect(agent.kind).toBe('plugin')
    expect(agent.id).toBe('agent')
    expect(agent.version).toBe('1.2.0')
    expect(agent.meta).toEqual({
      id: 'agent',
      version: '1.2.0',
      description: 'runs agents',
      requires: ['model', 'memory'],
      optional: ['tracing'],
      provides: ['agent'],
      peers: { logger: '^1.0.0' },
    })
    expect(JSON.parse(JSON.stringify(agent.meta)).requires).toEqual(['model', 'memory'])
  })

  it('is frozen all the way down', () => {
    expect(Object.isFrozen(agent)).toBe(true)
    expect(Object.isFrozen(agent.meta)).toBe(true)
    expect(Object.isFrozen(agent.meta.requires)).toBe(true)
    expect(Object.isFrozen(agent.tokens.requires)).toBe(true)
  })

  it('defaults declarations to empty lists', () => {
    const bare = definePlugin({ id: 'bare' })
    expect(bare.meta.requires).toEqual([])
    expect(bare.meta.optional).toEqual([])
    expect(bare.meta.provides).toEqual([])
    expect(bare.meta.peers).toBeUndefined()
  })

  it('is callable and returns a configured instance', () => {
    const instance = agent()
    expect(isPluginInstance(instance)).toBe(true)
    expect(instance.plugin).toBe(agent)
    expect(instance.config).toBeUndefined()
    expect(isPlugin(agent)).toBe(true)
    expect(isPlugin(instance)).toBe(false)
  })

  it('normalises plugins and instances', () => {
    expect(resolvePluginLike(agent, { a: 1 })).toEqual({ plugin: agent, config: { a: 1 } })
    const configured = definePlugin({
      id: 'cfg',
      config: schemaOf<{ port?: number }, { port: number }>(),
    })({ port: 9 })
    expect(resolvePluginLike(configured, { ignored: true }).config).toEqual({ port: 9 })
  })
})

describe('definePlugin validation', () => {
  it('rejects invalid ids', () => {
    expect(() => definePlugin({ id: 'bad id' })).toThrow(AimbraceError)
  })

  it('rejects invalid versions', () => {
    expect(() => definePlugin({ id: 'a', version: '1.0' })).toThrow(/not a valid semantic version/)
  })

  it('rejects things that are not service tokens', () => {
    expect(() => definePlugin({ id: 'a', requires: [{ name: 'model' }] as never })).toThrow(
      /not a service token/,
    )
    expect(() => definePlugin({ id: 'a', provides: 'model' as never })).toThrow(/must be an array/)
  })

  it('rejects a service listed twice', () => {
    expect(() => definePlugin({ id: 'a', requires: [Model, Model] })).toThrow(/listed twice/)
  })

  it('rejects a service that is both required and optional', () => {
    expect(() => definePlugin({ id: 'a', requires: [Model], optional: [Model] })).toThrow(
      /both required and optional/,
    )
  })
})

describe('definePlugin types', () => {
  it('limits ctx to what the plugin declared', () => {
    definePlugin({
      id: 'agent',
      requires: [Model, Memory],
      optional: [Tracing],
      provides: [Agent],
      setup(ctx) {
        expectTypeOf(ctx.get(Model)).toEqualTypeOf<Model>()
        expectTypeOf(ctx.get(Memory)).toEqualTypeOf<Memory>()
        expectTypeOf(ctx.maybe(Tracing)).toEqualTypeOf<Tracing | undefined>()
        expectTypeOf(ctx.pluginId).toEqualTypeOf<string>()

        // @ts-expect-error an optional service must be read with maybe(), not get()
        ctx.get(Tracing)
        // @ts-expect-error a required service is not optional
        ctx.maybe(Model)
        // @ts-expect-error a service nobody declared
        ctx.get(Agent)
        // @ts-expect-error provided services cannot be read through get
        ctx.get(Agent)

        ctx.provide(Agent, { run() {} })
        // @ts-expect-error wrong value type
        ctx.provide(Agent, 42)
        // @ts-expect-error a service that was not declared in provides
        ctx.provide(Model, { complete: () => '' })
      },
      start(ctx) {
        expectTypeOf(ctx.get(Model)).toEqualTypeOf<Model>()
      },
    })
  })

  it('allows nothing when nothing is declared', () => {
    definePlugin({
      id: 'empty',
      setup(ctx) {
        // @ts-expect-error nothing was declared
        ctx.get(Model)
        // @ts-expect-error nothing was declared
        ctx.maybe(Tracing)
        // @ts-expect-error nothing was declared
        ctx.provide(Agent, { run() {} })
      },
    })
  })

  it('infers config types from a Standard Schema', () => {
    const http = definePlugin({
      id: 'http',
      config: schemaOf<{ port?: number }, { port: number }>(),
      setup(_ctx, config) {
        expectTypeOf(config).toEqualTypeOf<{ port: number }>()
      },
    })
    http({ port: 3000 })
    http({})
    // @ts-expect-error wrong config input type
    http({ port: 'x' })

    const plain = definePlugin({
      id: 'plain',
      setup(_ctx, config) {
        expectTypeOf(config).toEqualTypeOf<undefined>()
      },
    })
    plain()
    // @ts-expect-error this plugin takes no config
    plain({ any: 1 })
  })

  it('accepts plugins of different shapes in one list', () => {
    const a = definePlugin({ id: 'a', provides: [Model] })
    const b = definePlugin({ id: 'b', requires: [Model], provides: [Memory] })
    const c = definePlugin({
      id: 'c',
      config: schemaOf<{ x: number }, { x: number }>(),
    })
    const list: PluginLike[] = [a, b, c({ x: 1 })]
    expect(list.map((entry) => (entry.kind === 'plugin' ? entry.id : entry.plugin.id))).toEqual([
      'a',
      'b',
      'c',
    ])
    expectTypeOf<ValueOf<(typeof a.tokens.provides)[number]>>().toEqualTypeOf<unknown>()
  })
})

function schemaOf<I, O>(): StandardSchemaV1<I, O> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) => ({ value: value as O }),
    },
  }
}
