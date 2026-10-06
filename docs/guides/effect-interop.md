# Effect interop

`@aimbrace/effect` connects AIMBRACE to [Effect 4](https://effect.website/) in both directions. `effect` is a peer
dependency (`^4.0.1`).

## A Layer becomes a plugin

An Effect `Layer<ROut, E, RIn>` already says what it needs (`RIn`) and what it builds (`ROut`). `layerPlugin` maps those
onto a plugin's `requires` and `provides`, and ties the layer's scope, its finalizers, to the plugin's disposal.

```ts
import { createApp, service } from '@aimbrace/core'
import { layerPlugin } from '@aimbrace/effect'
import { Context, Effect, Layer } from 'effect'

// AIMBRACE tokens...
const Config = service<{ url: string }>('config')
const Db = service<{ query(): string }>('db')

// ...and the Effect services that carry the same values.
class ConfigService extends Context.Service<ConfigService, { url: string }>()('app/Config') {}
class DbService extends Context.Service<DbService, { query(): string }>()('app/Db') {}

const dbLayer = Layer.effect(
  DbService,
  Effect.gen(function* () {
    const config = yield* ConfigService
    yield* Effect.acquireRelease(
      Effect.sync(() => console.log(`connect ${config.url}`)),
      () => Effect.sync(() => console.log('disconnect')), // runs when the plugin is disposed
    )
    return DbService.of({ query: () => `rows from ${config.url}` })
  }),
)

export const database = layerPlugin({
  id: 'database',
  requires: [[Config, ConfigService]], // the AIMBRACE Config is supplied to the layer as ConfigService
  provides: [[Db, DbService]],         // the layer's DbService is exposed as the AIMBRACE Db
  layer: dbLayer,
})
```

`database` is an ordinary plugin: it appears in the graph (`config -> database`), other plugins `require: [Db]`, a failing
layer fails `start()` with the layer's error and releases what it acquired, and `stop()` runs the finalizers after the
plugins that depend on it have stopped. The layer type must match the bindings: a layer that needs `ConfigService` while
`requires` is empty is a compile error.

## Effect programs read AIMBRACE services

`createEffectRuntime(read, bindings, owner?)` builds an Effect `ManagedRuntime` whose context holds AIMBRACE services as Effect
services. Bindings are bare tokens (bound to `effectService(token)`) or `[token, EffectService]` pairs. Pass the plugin
context (or a scope) as `owner` and the runtime is disposed with it.

```ts
import { effectService, createEffectRuntime } from '@aimbrace/effect'

setup(ctx) {
  const runtime = createEffectRuntime(ctx.get, [Db, [Config, ConfigService]], ctx)
  ctx.provide(Report, {
    run: () =>
      runtime.runPromise(
        Effect.gen(function* () {
          const db = yield* effectService(Db)
          const config = yield* ConfigService
          return `${db.query()} via ${config.url}`
        }),
      ),
  })
}
```

## Effect work ends with the scope

`runEffect(lifetime, runtime, effect)` passes the lifetime's `signal` to Effect's `runPromise`, so when a scope (or plugin, or app)
ends, the fiber is **interrupted** and its finalizers run, using Effect's own cancellation:

```ts
const task = await app.scope('task')
const result = runEffect(task, runtime, longRunningEffect)
await task.dispose() // interrupts the Effect; `result` rejects, finalizers have run
```

## Known limits

- The Effect identifier of a token is the token's own type (`ServiceToken<T>`), so two tokens with the same value type are
  indistinguishable to the Effect type checker. Their runtime keys differ (`aimbrace/<name>`).
- Effect's `Context<in R>` is contravariant, so the bridge erases the context type internally (one small file, `bindings.ts`).
- The bridge covers `Layer`, `Context` and `ManagedRuntime` interop. It does not wrap every Effect module.
