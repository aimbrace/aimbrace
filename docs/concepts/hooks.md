# Hooks

Hooks are how plugins observe and extend runtime behaviour. They are a **typed map**, not string events: every hook
name is declared, and the compiler checks the arguments. Underneath is [UnJS Hookable](https://github.com/unjs/hookable),
with live counters added so leaks are visible.

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin } from '@aimbrace/core'

const seen: string[] = []

const audit = definePlugin({
  id: 'audit',
  // Declared hooks are registered while the plugin is installed and removed when it is disposed.
  hooks: {
    'plugin:installed': (plugin) => void seen.push(`installed ${plugin.id}`),
    'app:ready': () => void seen.push('ready'),
  },
})

const app = createApp({ plugins: [audit] })
await app.start()
assert.deepEqual(seen, ['installed audit', 'ready'])
assert.equal(app.hooks.count(), 2)

await app.stop()
assert.equal(app.hooks.count(), 0)
```

## Core hooks

| Hook | Arguments | When |
|---|---|---|
| `graph:built` | `graph` | the graph was built and validated |
| `app:starting`, `app:ready`, `app:stopping`, `app:stopped` | none | app state changes |
| `plugin:install` | `plugin` | before `setup` |
| `plugin:installed` | `plugin` | after `setup` finished and services exist |
| `plugin:start`, `plugin:started` | `plugin` | around `start` |
| `plugin:stop`, `plugin:stopped` | `plugin` | around `stop` |
| `plugin:dispose` | `plugin` | after the plugin was disposed |
| `plugin:error` | `plugin`, `error` | a plugin failed |
| `service:provide`, `service:remove` | `service`, `plugin` | a service appeared or went away |
| `registry:change` | `event` | a registry entry was added or removed |
| `scope:open`, `scope:close` | `scope` | a scope was opened or ended |

`plugin` is `{ id, version, state }`; `scope` is `{ id, name, parent }`.

## Registering

- In the definition: `definePlugin({ hooks: { 'app:ready': fn } })`.
- At runtime: `ctx.hooks.hook(name, fn)` (also on scopes). The registration disappears with its owner.
- On the app: `app.hooks.hook(name, fn)`, for the composition root.

All return an unregister function. `hookOnce` runs at most once.

## Extending the map

A plugin declares its own hooks by merging into `HookExtensions`. The names are then checked everywhere:

```ts docs-test
import assert from 'node:assert/strict'
import { createApp } from '@aimbrace/core'

declare module '@aimbrace/core' {
  interface HookExtensions {
    'billing:charged': (info: { customer: string; cents: number }) => void
  }
}

const app = createApp()
const charges: string[] = []
app.hooks.hook('billing:charged', ({ customer, cents }) => void charges.push(`${customer}:${cents}`))

await app.hooks.callHook('billing:charged', { customer: 'ada', cents: 500 })
assert.deepEqual(charges, ['ada:500'])

// @ts-expect-error wrong argument type
await app.hooks.callHook('billing:charged', 'ada')
```

The packages in this repository do exactly this: `http:request`, `model:request`, `tool:before`, `agent:step`,
`memory:write` are all declared by merging.

## Serial and parallel

`callHook(name, ...args)` runs the handlers one after another in registration order and stops at the first failure.
`callHookParallel` starts them all together. Both always return a promise.

## Error semantics

- Lifecycle hooks (`plugin:*`, `app:*`, `graph:built`) are part of the contract: an error in one fails the step, so a policy
  hook can veto an install. Example: a `plugin:install` hook that throws fails that plugin and rolls the start back.
- Hooks fired on synchronous paths (`service:*`, `registry:change`, `scope:*`) are fire-and-forget; their errors go to the
  app's `onError`.

## Observers

`app.hooks.beforeEach(listener)` and `afterEach(listener)` see **every** call, including hooks nobody registered.
That is what tracing and `recordHooks` in [`@aimbrace/testing`](../guides/testing-plugins.md) are built on. Observers
are counted by `hooks.count()` and removed by `hooks.clear()`.

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, service } from '@aimbrace/core'

const Db = service<string>('db')
const app = createApp({
  plugins: [definePlugin({ id: 'db', provides: [Db], setup: (ctx) => void ctx.provide(Db, 'x') })],
})
const names: string[] = []
app.hooks.beforeEach((event) => void names.push(event.name))

await app.start()
assert.ok(names.includes('service:provide')) // no one registered it; the observer still sees it
await app.stop()
```

## Counting

`hooks.count(name?)` is the live number of registrations (observers included in the total). After `app.stop()` it is
zero; `app.probe().hooks` reports it.
