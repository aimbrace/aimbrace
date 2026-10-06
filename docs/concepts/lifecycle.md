# Lifecycle

An `App` is single-use and moves through these states:

```text
created -> starting -> running -> stopping -> stopped
              |
              +-> failed        (start failed and was rolled back)
```

## Start

`app.start()`:

1. Builds the graph and **validates every plugin config**. Problems from both are collected; one problem throws its
   own error, several throw `StartupValidationError`. **Nothing has run yet.**
2. Fires `graph:built` and `app:starting`.
3. Installs plugins one at a time in graph order: `plugin:install`, `setup`, check that every declared `provides` was
   provided (`UnfulfilledProvideError` otherwise), `plugin:installed`. Each plugin is awaited before the next begins.
4. Starts them in the same order: `plugin:start`, `start`, `plugin:started`.
5. Fires `app:ready`.

## Stop

`app.stop()` is idempotent and safe to call concurrently:

1. State becomes `stopping` and the app's `signal` **aborts immediately**, before any hook, so in-flight work starts
   to wind down.
2. Fires `app:stopping`. Disposes the app's own scopes and registry views (open request or task scopes end first).
3. Calls `stop` for started plugins in **reverse** order (`plugin:stop`, `stop`, `plugin:stopped`).
4. Disposes plugins in reverse order (`plugin:dispose`): each plugin's resources newest first, then its Cordis fiber.
5. Fires `app:stopped` and clears the app's hooks.

Every step runs even if an earlier one failed; failures are collected and `stop()` rejects with a `DisposalError`
listing all of them.

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, service } from '@aimbrace/core'

const A = service<string>('a')
const B = service<string>('b')
const log: string[] = []

const make = (id: string, requires: typeof A[] = [], provides: typeof A[] = []) =>
  definePlugin({
    id,
    requires,
    provides,
    setup(ctx) {
      for (const token of provides) ctx.provide(token as never, id as never)
      log.push(`setup ${id}`)
      return () => void log.push(`dispose ${id}`)
    },
    start: () => void log.push(`start ${id}`),
    stop: () => void log.push(`stop ${id}`),
  })

const app = createApp({ plugins: [make('web', [B]), make('db', [], [A]), make('repo', [A], [B])] })
await app.start()
await app.stop()

assert.deepEqual(log, [
  'setup db', 'setup repo', 'setup web',
  'start db', 'start repo', 'start web',
  'stop web', 'stop repo', 'stop db',
  'dispose web', 'dispose repo', 'dispose db',
])
assert.equal(app.probe().clean, true)
```

Why AIMBRACE drives shutdown itself: Cordis disposes a provider's effects before its dependents finish unloading.
"Stop in the reverse of the start order" is a guarantee AIMBRACE adds, see [Decisions](../architecture/decisions.md#r1-wrap-cordis-do-not-reimplement-it).

## Rollback

If `setup` throws in plugin 3 of 5, `start()` rejects with `PluginError` (`phase: 'install'`, `plugin: <id>`) and the
plugins already installed are stopped and disposed in reverse. The same happens for a failing `start`. The original
error is thrown; failures during the rollback itself go to `onError`.

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, PluginError } from '@aimbrace/core'

const log: string[] = []
const make = (id: string, fail = false) =>
  definePlugin({
    id,
    setup() {
      log.push(`setup ${id}`)
      if (fail) throw new Error('boom')
      return () => void log.push(`dispose ${id}`)
    },
  })

const app = createApp({ plugins: [make('p1'), make('p2'), make('p3', true), make('p4')] })
const error = await app.start().catch((e: unknown) => e)

assert.ok(error instanceof PluginError)
assert.equal(error.plugin, 'p3')
assert.equal(error.phase, 'install')
assert.deepEqual(log, ['setup p1', 'setup p2', 'setup p3', 'dispose p2', 'dispose p1'])
assert.equal(app.state, 'failed')
assert.equal(app.probe().clean, true)
```

## Validate without starting

`await app.validate()` checks the graph and every config and returns `{ ok, graph, errors }` without running any
`setup`. `aimbrace check` uses it.

## `await using`

An app implements `Symbol.asyncDispose`, and so does a scope:

```ts docs-test
import assert from 'node:assert/strict'
import { createApp } from '@aimbrace/core'

const app = createApp()
{
  await using running = app
  await running.start()
  assert.equal(running.state, 'running')
}
assert.equal(app.state, 'stopped')
```

## Provider replacement and reactivation

Because plugins are Cordis fibers, a dependent follows its providers. Remove a provider and its dependents are
stopped and go `pending`. Install another provider of the same service and the dependents run `setup` and `start`
again.

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, service } from '@aimbrace/core'

const Db = service<{ id: string }>('db')
const log: string[] = []

const db = (id: string) =>
  definePlugin({ id, provides: [Db], setup: (ctx) => void ctx.provide(Db, { id }) })
const agent = definePlugin({
  id: 'agent',
  requires: [Db],
  setup: (ctx) => void log.push(`setup with ${ctx.get(Db).id}`),
  start: () => void log.push('start'),
  stop: () => void log.push('stop'),
})

const app = createApp()
await app.start()
const first = await app.install(db('db-1'))
await app.install(agent)

await first.dispose()
await until(() => app.inspect().plugins.find((p) => p.id === 'agent')?.state === 'pending')

await app.install(db('db-2'))
await until(() => app.inspect().plugins.find((p) => p.id === 'agent')?.state === 'running')

assert.deepEqual(log, ['setup with db-1', 'start', 'stop', 'setup with db-2', 'start'])
await app.stop()

async function until(check: () => boolean) {
  while (!check()) await new Promise((resolve) => setTimeout(resolve, 5))
}
```

A reactivation that fails is reported through `onError` and the plugin shows state `failed` in `app.inspect()`.

## Dynamic installation

`app.install(plugin, config?, options?)` installs into a running app, validating against what is provided right now
(`MissingDependencyError`, `DuplicateProviderError`, `DuplicatePluginError`, `PeerError`), starts the plugin and
returns a handle. `handle.dispose()` stops and removes it. Before start use `app.use(...plugins)` or the `plugins`
option.

## Observing

| Call | Gives |
|---|---|
| `app.state` | `created`, `starting`, `running`, `stopping`, `stopped`, `failed` |
| `app.hooks` | the typed lifecycle hooks, see [Hooks](hooks.md#core-hooks) |
| `app.graph()` | the static [graph](dependency-graph.md) |
| `app.inspect()` | the observed tree: plugins with states, nested parents, services, scopes, registry sizes |
| `app.probe()` | leak counters: plugins, scopes, services, hooks, registry entries and subscribers, Cordis fibers; `clean` when all are zero |

`probe()` is what makes "no leaks" testable. After `stop()` every counter is zero, in every lifecycle test in the
repository; [`@aimbrace/testing`](../guides/testing-plugins.md) turns it into a one-line assertion.
