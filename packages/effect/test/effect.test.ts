import { createApp, definePlugin, PluginError, service } from '@aimbrace/core'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createEffectRuntime, effectService, layerPlugin, runEffect } from '../src'

interface Config {
  url: string
}
interface Db {
  query(): string
}
const Config = service<Config>('config')
const Db = service<Db>('db')
const Agent = service<{ ask(): Promise<string> }>('agent')

class ConfigService extends Context.Service<ConfigService, Config>()('test/Config') {}
class DbService extends Context.Service<DbService, Db>()('test/Db') {}

const configPlugin = definePlugin({
  id: 'config',
  provides: [Config],
  setup: (ctx) => void ctx.provide(Config, { url: 'postgres://db' }),
})

function dbLayer(log: string[], options: { fail?: boolean } = {}) {
  return Layer.effect(
    DbService,
    Effect.gen(function* () {
      const config = yield* ConfigService
      yield* Effect.acquireRelease(
        Effect.sync(() => void log.push(`acquire ${config.url}`)),
        () => Effect.sync(() => void log.push('release')),
      )
      if (options.fail) return yield* Effect.fail(new Error('cannot connect'))
      return DbService.of({ query: () => `rows from ${config.url}` })
    }),
  )
}

describe('effectService', () => {
  it('creates one stable key per token with a namespaced name', () => {
    expect(effectService(Db)).toBe(effectService(Db))
    expect(effectService(Db)).not.toBe(effectService(Config))
    expect(effectService(Db).key).toBe('aimbrace/db')
  })
})

describe('createEffectRuntime', () => {
  it('lets Effect programs read AIMBRACE services, bare or bound', async () => {
    const consumer = definePlugin({
      id: 'consumer',
      requires: [Config, Db],
      provides: [Agent],
      setup(ctx) {
        const runtime = createEffectRuntime(ctx.get, [Db, [Config, ConfigService]], ctx)
        ctx.provide(Agent, {
          ask: () =>
            runtime.runPromise(
              Effect.gen(function* () {
                const db = yield* effectService(Db)
                const config = yield* ConfigService
                return `${db.query()} via ${config.url}`
              }),
            ),
        })
      },
    })
    const provider = definePlugin({
      id: 'db',
      provides: [Db],
      setup: (ctx) => void ctx.provide(Db, { query: () => 'rows' }),
    })
    const app = createApp({ plugins: [consumer, provider, configPlugin] })
    await app.start()
    expect(await app.get(Agent).ask()).toBe('rows via postgres://db')
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('disposes the runtime with its owner', async () => {
    const log: string[] = []
    const holder = definePlugin({
      id: 'holder',
      requires: [Config],
      setup(ctx) {
        const runtime = createEffectRuntime(ctx.get, [Config], ctx)
        void runtime
          .runPromise(
            Effect.scoped(
              Effect.acquireRelease(
                Effect.sync(() => void log.push('acquire')),
                () => Effect.sync(() => void log.push('release')),
              ).pipe(Effect.andThen(Effect.never)),
            ),
            // Disposing the runtime interrupts this fiber; that rejection is expected.
          )
          .catch(() => {})
      },
    })
    const app = createApp({ plugins: [configPlugin, holder] })
    await app.start()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(log).toEqual(['acquire'])
    await app.stop()
    expect(log).toEqual(['acquire', 'release'])
  })

  it('types the runtime with the identifiers of its bindings', () => {
    const runtime = createEffectRuntime(() => ({}), [Db, [Config, ConfigService]] as const)
    expectTypeOf(runtime.runPromise<string, never>)
      .parameter(0)
      .toExtend<
        Effect.Effect<string, never, ConfigService | import('@aimbrace/core').ServiceToken<Db>>
      >()
    void runtime.dispose()
  })
})

describe('runEffect', () => {
  it('interrupts the Effect, running its finalizers, when the scope ends', async () => {
    const log: string[] = []
    const app = createApp({ plugins: [configPlugin] })
    await app.start()
    const runtime = createEffectRuntime(app.get.bind(app), [Config])
    const scope = await app.scope('task')
    const running = runEffect(
      scope,
      runtime,
      Effect.scoped(
        Effect.acquireRelease(
          Effect.sync(() => void log.push('acquire')),
          () => Effect.sync(() => void log.push('release')),
        ).pipe(Effect.andThen(Effect.sleep('10 seconds')), Effect.as('finished')),
      ),
    )
    const outcome = running.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(log).toEqual(['acquire'])
    await scope.dispose()
    const result = await outcome
    expect(result.ok).toBe(false)
    expect(log).toEqual(['acquire', 'release'])
    await runtime.dispose()
    await app.stop()
  })

  it('lets an Effect that finishes first resolve normally', async () => {
    const app = createApp({ plugins: [configPlugin] })
    await app.start()
    const runtime = createEffectRuntime(app.get.bind(app), [Config])
    const scope = await app.scope('task')
    expect(await runEffect(scope, runtime, Effect.succeed(7))).toBe(7)
    await scope.dispose()
    await runtime.dispose()
    await app.stop()
  })
})

describe('layerPlugin', () => {
  it('turns a Layer into a plugin: inputs are requires, outputs are provides, finalizers run on dispose', async () => {
    const log: string[] = []
    const database = layerPlugin({
      id: 'database',
      requires: [[Config, ConfigService]],
      provides: [[Db, DbService]],
      layer: dbLayer(log),
    })
    const user = definePlugin({
      id: 'user',
      requires: [Db],
      setup(ctx) {
        log.push(`setup user: ${ctx.get(Db).query()}`)
        return () => void log.push('dispose user')
      },
    })
    const app = createApp({ plugins: [user, database, configPlugin] })
    expect(app.graph().order).toEqual(['config', 'database', 'user'])
    await app.start()
    expect(log).toEqual(['acquire postgres://db', 'setup user: rows from postgres://db'])
    expect(app.get(Db).query()).toBe('rows from postgres://db')
    await app.stop()
    expect(log).toEqual([
      'acquire postgres://db',
      'setup user: rows from postgres://db',
      'dispose user',
      'release',
    ])
    expect(app.probe().clean).toBe(true)
  })

  it('works with no inputs and bare descriptions', async () => {
    const standalone = layerPlugin({
      id: 'standalone',
      version: '1.2.3',
      description: 'no inputs',
      provides: [[Db, DbService]],
      layer: Layer.succeed(DbService, DbService.of({ query: () => 'static' })),
    })
    expect(standalone.version).toBe('1.2.3')
    expect(standalone.meta.requires).toEqual([])
    expect(standalone.meta.provides).toEqual(['db'])
    const app = createApp({ plugins: [standalone] })
    await app.start()
    expect(app.get(Db).query()).toBe('static')
    await app.stop()
  })

  it('fails start with the layer error and releases what the layer acquired', async () => {
    const log: string[] = []
    const database = layerPlugin({
      id: 'database',
      requires: [[Config, ConfigService]],
      provides: [[Db, DbService]],
      layer: dbLayer(log, { fail: true }),
    })
    const app = createApp({ plugins: [database, configPlugin] })
    const error = (await app.start().catch((e: unknown) => e)) as PluginError
    expect(error).toBeInstanceOf(PluginError)
    expect(error.plugin).toBe('database')
    expect(String(error.message)).toContain('cannot connect')
    expect(log).toEqual(['acquire postgres://db', 'release'])
    expect(app.probe().clean).toBe(true)
  })

  it('preserves the declared tokens in the plugin metadata and types', () => {
    const database = layerPlugin({
      id: 'database',
      requires: [[Config, ConfigService]],
      provides: [[Db, DbService]],
      layer: dbLayer([]),
    })
    expect(database.meta.requires).toEqual(['config'])
    expect(database.meta.provides).toEqual(['db'])
    expectTypeOf(database.tokens.requires).toMatchTypeOf<readonly unknown[]>()
  })

  it('rejects a layer whose inputs or outputs do not match the bindings (compile time)', () => {
    layerPlugin({
      id: 'bad',
      requires: [],
      provides: [[Db, DbService]],
      // @ts-expect-error the layer needs ConfigService but nothing declares it in requires
      layer: dbLayer([]),
    })
  })
})
