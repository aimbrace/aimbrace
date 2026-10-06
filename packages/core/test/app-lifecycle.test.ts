import { describe, expect, it } from 'vitest'
import {
  AppStateError,
  ConfigError,
  createApp,
  DependencyCycleError,
  DisposalError,
  definePlugin,
  MissingDependencyError,
  PluginError,
  StartupValidationError,
  service,
  UndeclaredAccessError,
  UnfulfilledProvideError,
} from '../src'
import { objectSchema } from './helpers'

interface Settings {
  name: string
}
interface Memory {
  recall(): string[]
}
interface Runtime {
  run(): string
}

const Settings = service<Settings>('settings')
const Memory = service<Memory>('memory')
const Runtime = service<Runtime>('runtime')

function setup() {
  const log: string[] = []
  const settings = definePlugin({
    id: 'settings',
    provides: [Settings],
    setup(ctx) {
      log.push('setup:settings')
      ctx.provide(Settings, { name: 'prod' })
      return () => void log.push('dispose:settings')
    },
    start: () => void log.push('start:settings'),
    stop: () => void log.push('stop:settings'),
  })
  const memory = definePlugin({
    id: 'memory',
    requires: [Settings],
    provides: [Memory],
    setup(ctx) {
      log.push(`setup:memory(${ctx.get(Settings).name})`)
      ctx.provide(Memory, { recall: () => ['a', 'b'] })
      return () => void log.push('dispose:memory')
    },
    start: () => void log.push('start:memory'),
    stop: () => void log.push('stop:memory'),
  })
  const agent = definePlugin({
    id: 'agent',
    requires: [Memory],
    provides: [Runtime],
    setup(ctx) {
      log.push(`setup:agent(${ctx.get(Memory).recall().join('')})`)
      ctx.provide(Runtime, { run: () => 'ran' })
      return () => void log.push('dispose:agent')
    },
    start: () => void log.push('start:agent'),
    stop: () => void log.push('stop:agent'),
  })
  return { log, settings, memory, agent }
}

describe('start', () => {
  it('installs in dependency order whatever the listing order, then starts', async () => {
    const { log, settings, memory, agent } = setup()
    const app = createApp({ plugins: [agent, memory, settings] })
    await app.start()
    expect(app.state).toBe('running')
    expect(log).toEqual([
      'setup:settings',
      'setup:memory(prod)',
      'setup:agent(ab)',
      'start:settings',
      'start:memory',
      'start:agent',
    ])
    expect(app.get(Runtime).run()).toBe('ran')
    expect(app.maybe(Settings)).toEqual({ name: 'prod' })
    await app.stop()
  })

  it('supports app.use() before start and chains', async () => {
    const { settings, memory } = setup()
    const app = createApp().use(settings).use(memory)
    await app.start()
    expect(app.get(Memory).recall()).toEqual(['a', 'b'])
    await app.stop()
  })

  it('exposes the static graph before and after start', async () => {
    const { settings, memory, agent } = setup()
    const app = createApp({ plugins: [agent, memory, settings] })
    expect(app.graph().order).toEqual(['settings', 'memory', 'agent'])
    await app.start()
    expect(app.graph().order).toEqual(['settings', 'memory', 'agent'])
    await app.stop()
  })

  it('rejects a plugin that declares provides but does not provide, naming plugin and service', async () => {
    const forgetful = definePlugin({ id: 'forgetful', provides: [Settings], setup() {} })
    const app = createApp({ plugins: [forgetful] })
    const error = await app.start().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UnfulfilledProvideError)
    expect((error as UnfulfilledProvideError).plugin).toBe('forgetful')
    expect((error as UnfulfilledProvideError).services).toEqual(['settings'])
    expect(app.state).toBe('failed')
    expect(app.probe().clean).toBe(true)
  })

  it('enforces declarations at runtime too', async () => {
    const sneaky = definePlugin({
      id: 'sneaky',
      setup(ctx) {
        ;(ctx as unknown as { get(token: unknown): unknown }).get(Settings)
      },
    })
    const app = createApp({ plugins: [sneaky] })
    const error = (await app.start().catch((e: unknown) => e)) as PluginError
    expect(error).toBeInstanceOf(PluginError)
    expect(error.phase).toBe('install')
    expect(error.cause).toBeInstanceOf(UndeclaredAccessError)
    expect((error.cause as UndeclaredAccessError).service).toBe('settings')
    expect(app.probe().clean).toBe(true)
  })

  it('validates the graph before running any setup', async () => {
    const { log, memory, agent } = setup()
    const missing = createApp({ plugins: [agent, memory] })
    const error = await missing.start().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MissingDependencyError)
    expect((error as MissingDependencyError).service).toBe('settings')
    expect(log).toEqual([])

    const a = definePlugin({ id: 'a', requires: [Memory], provides: [Settings] })
    const b = definePlugin({ id: 'b', requires: [Settings], provides: [Memory] })
    const cyclic = createApp({ plugins: [a, b] })
    const cycle = await cyclic.start().catch((e: unknown) => e)
    expect(cycle).toBeInstanceOf(DependencyCycleError)
    expect((cycle as DependencyCycleError).cycle).toEqual(['a', 'b', 'a'])
  })

  it('validates every config before any setup, applies schema defaults and passes the parsed value', async () => {
    const seen: unknown[] = []
    const http = definePlugin({
      id: 'http',
      config: objectSchema({ port: 'number', host: 'string' }, { host: 'localhost' }),
      setup(_ctx, config) {
        seen.push(config)
      },
    })
    const ok = createApp({ plugins: [http({ port: 8080 })] })
    await ok.start()
    expect(seen).toEqual([{ port: 8080, host: 'localhost' }])
    await ok.stop()

    const log: string[] = []
    const first = definePlugin({ id: 'first', setup: () => void log.push('first') })
    const bad = createApp({ plugins: [first, http({ port: 'x' as never })] })
    const error = await bad.start().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConfigError)
    expect((error as ConfigError).issues).toEqual([{ message: 'expected number', path: 'port' }])
    expect(log).toEqual([])
  })

  it('combines several startup problems into one error', async () => {
    const http = definePlugin({ id: 'http', config: objectSchema({ port: 'number' }) })
    const needy = definePlugin({ id: 'needy', requires: [Settings] })
    const app = createApp({ plugins: [needy, http({})] })
    const error = await app.start().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StartupValidationError)
    expect((error as StartupValidationError).errors).toHaveLength(2)
  })

  it('passes a plugin its setup in async order (awaits async setup before dependents)', async () => {
    const log: string[] = []
    const slow = definePlugin({
      id: 'slow',
      provides: [Settings],
      async setup(ctx) {
        log.push('slow:begin')
        await new Promise((resolve) => setTimeout(resolve, 15))
        ctx.provide(Settings, { name: 'late' })
        log.push('slow:end')
      },
    })
    const user = definePlugin({
      id: 'user',
      requires: [Settings],
      setup(ctx) {
        log.push(`user:${ctx.get(Settings).name}`)
      },
    })
    const app = createApp({ plugins: [user, slow] })
    await app.start()
    expect(log).toEqual(['slow:begin', 'slow:end', 'user:late'])
    await app.stop()
  })
})

describe('stop and rollback', () => {
  it('stops in reverse dependency order, then disposes in reverse order, and leaves nothing behind', async () => {
    const { log, settings, memory, agent } = setup()
    const app = createApp({ plugins: [agent, memory, settings] })
    await app.start()
    log.length = 0
    expect(app.probe()).toMatchObject({ plugins: 3, services: 3, clean: false })
    await app.stop()
    expect(log).toEqual([
      'stop:agent',
      'stop:memory',
      'stop:settings',
      'dispose:agent',
      'dispose:memory',
      'dispose:settings',
    ])
    expect(app.state).toBe('stopped')
    expect(app.probe()).toEqual({
      plugins: 0,
      scopes: 0,
      services: 0,
      hooks: 0,
      registryEntries: 0,
      registrySubscribers: 0,
      fibers: 0,
      clean: true,
    })
  })

  it('rolls back in reverse when a setup fails midway', async () => {
    const log: string[] = []
    const make = (id: string, fail = false) =>
      definePlugin({
        id,
        setup() {
          log.push(`setup:${id}`)
          if (fail) throw new Error('boom')
          return () => void log.push(`dispose:${id}`)
        },
        stop: () => void log.push(`stop:${id}`),
      })
    const app = createApp({ plugins: [make('p1'), make('p2'), make('p3', true), make('p4')] })
    const error = (await app.start().catch((e: unknown) => e)) as PluginError
    expect(error).toBeInstanceOf(PluginError)
    expect(error.plugin).toBe('p3')
    expect(error.phase).toBe('install')
    expect((error.cause as Error).message).toBe('boom')
    expect(log).toEqual(['setup:p1', 'setup:p2', 'setup:p3', 'dispose:p2', 'dispose:p1'])
    expect(app.state).toBe('failed')
    expect(app.probe().clean).toBe(true)
  })

  it('rolls back started plugins, stopping them first, when a start fails', async () => {
    const log: string[] = []
    const make = (id: string, failStart = false) =>
      definePlugin({
        id,
        setup: () => () => void log.push(`dispose:${id}`),
        start() {
          log.push(`start:${id}`)
          if (failStart) throw new Error('cannot start')
        },
        stop: () => void log.push(`stop:${id}`),
      })
    const app = createApp({ plugins: [make('a'), make('b', true), make('c')] })
    const error = (await app.start().catch((e: unknown) => e)) as PluginError
    expect(error.phase).toBe('start')
    expect(error.plugin).toBe('b')
    expect(log).toEqual(['start:a', 'start:b', 'stop:a', 'dispose:c', 'dispose:b', 'dispose:a'])
    expect(app.probe().clean).toBe(true)
  })

  it('runs every stop and disposer even when some fail, and reports all of them', async () => {
    const log: string[] = []
    const make = (id: string, failStop: boolean, failDispose: boolean) =>
      definePlugin({
        id,
        setup: () => () => {
          log.push(`dispose:${id}`)
          if (failDispose) throw new Error(`dispose ${id}`)
        },
        stop() {
          log.push(`stop:${id}`)
          if (failStop) throw new Error(`stop ${id}`)
        },
      })
    const app = createApp({
      plugins: [make('a', false, true), make('b', true, false), make('c', false, false)],
    })
    await app.start()
    const error = (await app.stop().catch((e: unknown) => e)) as DisposalError
    expect(error).toBeInstanceOf(DisposalError)
    expect(log).toEqual(['stop:c', 'stop:b', 'stop:a', 'dispose:c', 'dispose:b', 'dispose:a'])
    expect(error.errors).toHaveLength(2)
    const messages = error.errors.map(
      (e) => ((e as Error).cause as Error | undefined)?.message ?? (e as Error).message,
    )
    expect(messages.sort()).toEqual(['dispose a', 'stop b'])
    expect(app.state).toBe('stopped')
    expect(app.probe().clean).toBe(true)
  })

  it('is safe to stop twice, and an app is single use', async () => {
    const { settings } = setup()
    const app = createApp({ plugins: [settings] })
    await app.start()
    await Promise.all([app.stop(), app.stop()])
    await app.stop()
    expect(app.state).toBe('stopped')
    await expect(app.start()).rejects.toBeInstanceOf(AppStateError)
    expect(() => app.use(settings)).toThrow(AppStateError)
  })

  it('stopping an app that never started is harmless', async () => {
    const app = createApp({ plugins: [setup().settings] })
    await app.stop()
    expect(app.state).toBe('stopped')
    expect(app.probe().clean).toBe(true)
  })

  it('refuses use() after start and install() before start', async () => {
    const { settings, memory } = setup()
    const app = createApp({ plugins: [settings] })
    await expect(app.install(memory)).rejects.toThrow(AppStateError)
    await app.start()
    expect(() => app.use(memory)).toThrow(AppStateError)
    await app.stop()
  })

  it('supports await using', async () => {
    const { settings } = setup()
    const app = createApp({ plugins: [settings] })
    {
      await using scoped = app
      await scoped.start()
    }
    expect(app.state).toBe('stopped')
    expect(app.probe().clean).toBe(true)
  })

  it('aborts the app signal when stopping begins', async () => {
    const app = createApp({ plugins: [setup().settings] })
    await app.start()
    expect(app.signal.aborted).toBe(false)
    const stopping = app.stop()
    expect(app.signal.aborted).toBe(true)
    await stopping
  })
})
