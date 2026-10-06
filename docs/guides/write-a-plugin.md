# Write a plugin

This guide takes one plugin from nothing to publishable. The rules in the middle are the ones that keep a plugin
well behaved when it is installed, replaced, reactivated and disposed.

## 1. Decide the seam

Ask what the plugin offers and what it needs.

- It **offers** a capability others call: that is a *service* (`provides`).
- It **contributes** items to a shared collection: that is a *registry* entry (tools, routes, commands).
- It **watches** the system: that is a *hook*.

A plugin may do any combination.

## 2. A complete example

A rate limiter: configurable, provides a service, cleans up its timer, and tells the world through a typed hook.

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, service, type StandardSchemaV1 } from '@aimbrace/core'
import { withApp } from '@aimbrace/testing'

// 1. The service and the hook this plugin owns.
export interface Limiter {
  /** Returns false when the caller is over the limit. */
  allow(key: string): boolean
}
export const Limiter = service<Limiter>('rate-limiter', { description: 'Fixed-window rate limiter' })

declare module '@aimbrace/core' {
  interface HookExtensions {
    'limiter:rejected': (info: { key: string }) => void
  }
}

// 2. Config. The schema accepts undefined, so the plugin works when used bare.
interface Config {
  limit: number
  windowMs: number
}
const config: StandardSchemaV1<Partial<Config> | undefined, Config> = {
  '~standard': {
    version: 1,
    vendor: 'example',
    validate(value) {
      const { limit = 5, windowMs = 60_000 } = value ?? {}
      if (!Number.isInteger(limit) || limit < 1) return { issues: [{ message: 'must be a positive integer', path: ['limit'] }] }
      return { value: { limit, windowMs } }
    },
  },
}

// 3. The plugin. State lives inside setup: one activation, one limiter.
export const rateLimiter = definePlugin({
  id: 'rate-limiter',
  version: '1.0.0',
  provides: [Limiter],
  config,
  setup(ctx, { limit, windowMs }) {
    const counts = new Map<string, number>()
    // Resources go through ctx so they are released when the plugin is disposed.
    const timer = setInterval(() => counts.clear(), windowMs)
    ctx.own(() => clearInterval(timer))

    ctx.provide(Limiter, {
      allow(key) {
        const used = (counts.get(key) ?? 0) + 1
        counts.set(key, used)
        if (used <= limit) return true
        // Hook errors on a synchronous path must not break the caller: report them.
        ctx.hooks.callHook('limiter:rejected', { key }).catch((error) => ctx.report(error, 'limiter:rejected'))
        return false
      },
    })
  },
})

// 4. Use it, and prove it behaves.
const rejected: string[] = []
await withApp({ plugins: [rateLimiter({ limit: 2 })] }, async (app) => {
  app.hooks.hook('limiter:rejected', ({ key }) => void rejected.push(key))
  const limiter = app.get(Limiter)
  assert.deepEqual([limiter.allow('ada'), limiter.allow('ada'), limiter.allow('ada')], [true, true, false])
  assert.equal(limiter.allow('bob'), true)
  await new Promise((resolve) => setTimeout(resolve, 5))
})
assert.deepEqual(rejected, ['ada']) // withApp also asserted that nothing leaked (the timer is cleared)

// A bad config fails the start with the path of the problem.
await assert.rejects(createApp({ plugins: [rateLimiter({ limit: 0 })] }).start(), /must be a positive integer \(at limit\)/)
```

## 3. The rules

**Declare everything.** If `setup` calls `ctx.get(X)`, `X` is in `requires`. The compiler and the runtime enforce it,
and the graph can only order what you declare.

**Provide during `setup`.** Dependents are installed as soon as `setup` returns. A service provided later (in `start`) is
not there for them, and `UnfulfilledProvideError` tells you so.

**Keep state inside `setup`.** A plugin object may be installed in several apps, and the same app may reactivate it when a
provider returns. Module-level `let` state leaks between activations. If you need state shared between `setup`, `start`
and `stop`, close over it in `setup` and register `start`/`stop` behaviour with `ctx.hooks` or return a disposer, or keep a
`WeakMap` keyed by `ctx` (hosts in this repository do).

**Acquire through `ctx`.** Timers, listeners, sockets and servers go in `ctx.own(...)` (or inside `start` with a matching
`stop`). Registry entries and hooks registered through `ctx` are removed for you. Pass `ctx.signal` to anything
cancellable so shutdown interrupts it.

**Await every asynchronous removal.** A disposer that returns a promise is awaited. A fire-and-forget disposer is a leak the
probe will not see until it fails in production.

**Never throw into the void.** Errors with no caller (a hook on a synchronous path, a background task) go to
`ctx.report(error, where)`, which reaches the app's `onError`.

**Schemas must accept `undefined`.** A bare plugin passes `undefined`. With valibot: `v.optional(shape, v.getDefaults(shape))`.

**Do not reach into hosts.** Contribute to a registry or provide a service through a neutral package. A route plugin
imports `@aimbrace/http`, not Hono. See [Hosts](../concepts/hosts.md).

**Ids and names.** Use a lower-case id; namespace service and registry names (`acme/search`) when the plugin is meant to be shared.

## 4. Test it

```ts
import { withApp, mockService, recordHooks } from '@aimbrace/testing'

await withApp({ plugins: [mockService(Clock, fakeClock), rateLimiter] }, async (app) => {
  // assertions
}) // stops the app and fails the test if anything leaked
```

See [Test plugins](testing-plugins.md).

## 5. Publish it

A plugin package default-exports its main plugin (or exports it as `plugin`) and declares its entry so tools can find
it. Host libraries are peer dependencies, never dependencies.

```json
{
  "name": "@acme/aimbrace-rate-limiter",
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "peerDependencies": { "@aimbrace/core": "^0.1.0" },
  "aimbrace": { "plugin": "./dist/index.js" }
}
```

- `aimbrace plugins` lists installed packages with the `aimbrace.plugin` field.
- The [loader](config-and-loader.md) resolves `{ use: '@acme/aimbrace-rate-limiter', config: { limit: 10 } }` from a config file.
