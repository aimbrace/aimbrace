# Plugins

A plugin is a **declarative composition unit**: what it needs, what it offers, what it watches, and how to start
and stop. `definePlugin` captures that in an immutable object.

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, service } from '@aimbrace/core'

const Clock = service<{ now(): number }>('clock')
const Stamper = service<{ stamp(text: string): string }>('stamper')

export const stamper = definePlugin({
  id: 'stamper',
  version: '1.0.0',
  description: 'Prefixes text with the time',
  requires: [Clock],
  provides: [Stamper],
  setup(ctx) {
    const clock = ctx.get(Clock)
    ctx.provide(Stamper, { stamp: (text) => `[${clock.now()}] ${text}` })
  },
})

// A plugin is plain data you can inspect (and serialise).
assert.deepEqual(stamper.meta, {
  id: 'stamper',
  version: '1.0.0',
  description: 'Prefixes text with the time',
  requires: ['clock'],
  optional: [],
  provides: ['stamper'],
  peers: undefined,
})

const clock = definePlugin({
  id: 'clock',
  provides: [Clock],
  setup: (ctx) => void ctx.provide(Clock, { now: () => 7 }),
})

const app = createApp({ plugins: [stamper, clock] })
await app.start()
assert.equal(app.get(Stamper).stamp('hi'), '[7] hi')
await app.stop()
```

## Definition

| Field | Meaning |
|---|---|
| `id` | Unique in the app. Letters, digits and `._:/-`. |
| `version` | Semantic version. Other plugins can require a range of it with `peers`. |
| `description` | Shown in graphs and listings. |
| `requires` | Services that must be provided by some plugin. |
| `optional` | Services used when present (`ctx.maybe`). |
| `provides` | Services this plugin makes available. `setup` must provide each. |
| `peers` | `{ [pluginId]: semverRange }`: other plugins that must be registered, with a version range. |
| `config` | A [Standard Schema](https://standardschema.dev) validating the plugin's config. |
| `hooks` | Hooks registered while the plugin is installed. |
| `setup(ctx, config)` | Acquire resources and provide services. May return a cleanup function. |
| `start(ctx, config)` | Runs after every plugin is installed, in dependency order. |
| `stop(ctx, config)` | Runs before disposal, in reverse order. |

## The plugin context

`setup`, `start` and `stop` receive a `PluginContext`. Its `get`, `maybe` and `provide` are limited to your
declarations; everything else is open:

| Member | Purpose |
|---|---|
| `pluginId`, `name` | Identity (`plugin:<id>`). |
| `signal` | An `AbortSignal` aborted when this activation ends. Pass it to anything cancellable. |
| `own(disposer)` | Release something when the plugin is disposed. Returns a function that forgets it. |
| `hooks` | Register hooks that disappear with the plugin; call hooks. |
| `registry(token)` | A [registry](registries.md) view whose additions disappear with the plugin. |
| `scope(name, options?)` | Open a child [scope](scopes.md). Ends with the plugin. |
| `install(plugin, config?, options?)` | Install a nested plugin, see [Isolation and nesting](isolation-and-nesting.md). |
| `report(error, where?)` | Report an error that cannot be thrown to a caller (goes to the app's `onError`). |

The methods are bound, so `const { get, registry } = ctx` and `createRuntime(ctx.get)` work.

## Everything acquired through the context is released

A resource acquired through `ctx` (a registry entry, a hook, a scope, an owned disposer, a provided service) is
released when the plugin is disposed, newest first. A cleanup function returned from `setup` runs first.

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin } from '@aimbrace/core'

const log: string[] = []
const timer = definePlugin({
  id: 'timer',
  setup(ctx) {
    ctx.own(() => void log.push('owned: first registered, last released'))
    ctx.own(() => void log.push('owned: second registered'))
    return () => void log.push('returned from setup: released first')
  },
  stop: () => void log.push('stop'),
})

const app = createApp({ plugins: [timer] })
await app.start()
await app.stop()

assert.deepEqual(log, [
  'stop',
  'returned from setup: released first',
  'owned: second registered',
  'owned: first registered, last released',
])
```

## Config

A plugin with a `config` schema receives the validated, parsed value as the second argument of `setup`, `start` and
`stop`. Call the plugin to configure it: `database({ url: '...' })`. The schema runs for every plugin before any
`setup` runs, so a bad config fails the whole start with the issue paths.

```ts docs-test
import assert from 'node:assert/strict'
import { ConfigError, createApp, definePlugin, type StandardSchemaV1 } from '@aimbrace/core'

// Any Standard Schema library works (valibot, zod, arktype). This one is hand written to keep the page dependency free.
const port: StandardSchemaV1<{ port?: number } | undefined, { port: number }> = {
  '~standard': {
    version: 1,
    vendor: 'docs',
    validate(value) {
      const input = value ?? {} // a plugin used with no config receives undefined
      if (input.port === undefined) return { value: { port: 3000 } }
      if (typeof input.port !== 'number') return { issues: [{ message: 'expected a number', path: ['port'] }] }
      return { value: { port: input.port } }
    },
  },
}

const received: number[] = []
const server = definePlugin({
  id: 'server',
  config: port,
  setup: (_ctx, config) => void received.push(config.port),
})

await createApp({ plugins: [server] }).start() // bare: defaults apply
await createApp({ plugins: [server({ port: 8080 })] }).start()
assert.deepEqual(received, [3000, 8080])

const error = await createApp({ plugins: [server({ port: 'x' as never })] })
  .start()
  .catch((e: unknown) => e)
assert.ok(error instanceof ConfigError)
assert.deepEqual(error.issues, [{ message: 'expected a number', path: 'port' }])
```

> **A schema must accept `undefined`.** A plugin used bare (`plugins: [server]`) passes `undefined` to its schema. With
> valibot write `v.optional(shape, v.getDefaults(shape))`, not just `shape`.

## Callable plugins

A plugin is also a function: `plugin(config)` returns a configured instance that `createApp({ plugins })` and
`app.use` accept. `plugin(config)` does not validate; validation happens once, at start.

## Peers

`peers: { logger: '^1.2.0' }` requires another registered plugin and a version range of it. It is checked with the
graph, before anything runs. See [The dependency graph](dependency-graph.md#peers-and-versions).

## Plugin objects are frozen

`definePlugin` freezes the plugin, its metadata and its token lists. Share plugin objects freely, between apps
too: per-activation state belongs inside `setup`, never in module scope. See [Write a plugin](../guides/write-a-plugin.md).
