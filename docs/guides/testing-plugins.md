# Test plugins

`@aimbrace/testing` makes the framework's own discipline, *start, stop, assert nothing leaked*, one call.

```ts docs-test
import assert from 'node:assert/strict'
import { definePlugin, service } from '@aimbrace/core'
import { assertClean, LeakError, mockService, recordHooks, startTestApp, waitFor, withApp } from '@aimbrace/testing'

const Clock = service<{ now(): number }>('clock')
const Stamp = service<string>('stamp')

const stamper = definePlugin({
  id: 'stamper',
  requires: [Clock],
  provides: [Stamp],
  setup: (ctx) => void ctx.provide(Stamp, `t=${ctx.get(Clock).now()}`),
})

// withApp: start, run the body, stop, and fail if anything leaked. The body result is returned.
const stamp = await withApp({ plugins: [mockService(Clock, { now: () => 7 }), stamper] }, (app) => app.get(Stamp))
assert.equal(stamp, 't=7')

// startTestApp: `await using` does the same at the end of a block, and records hooks from the start.
{
  await using t = await startTestApp({ plugins: [mockService(Clock, { now: () => 1 })] })
  assert.ok(t.hooks.names().includes('app:ready'))
}

// recordHooks: every hook call, in order, with arguments.
const recorder = recordHooks((await startTestApp({ plugins: [] })).app)
assert.deepEqual(recorder.names(), [])

// waitFor polls a condition; a leak report names the counters that were not zero.
assert.equal(await waitFor(() => 'ready'), 'ready')
const dirty = { plugins: 1, scopes: 0, services: 2, hooks: 0, registryEntries: 0, registrySubscribers: 0, fibers: 0, clean: false }
assert.throws(() => assertClean({ probe: () => dirty } as never), LeakError)
```

## The helpers

| Helper | Use |
|---|---|
| `withApp(options, body)` | Start an app, run `body(app)`, stop, assert clean. A failing body still stops the app and rethrows its own error. |
| `startTestApp(options)` | Returns `{ app, hooks }` and implements `Symbol.asyncDispose`; with `await using` it stops and asserts clean at the end of the block. |
| `mockService(token, value, id?)` | A plugin that provides a fixed value: a stub or a spy for the real provider. |
| `recordHooks(app)` | Records every hook call (`records`, `names()`, `clear()`, `stop()`). |
| `assertClean(app)` | Throws `LeakError` listing every non-zero probe counter. Call it after `stop()`. |
| `waitFor(check, timeout?)` | Poll until the check is truthy; rejects with a clear timeout. |
| `deferred()` | A promise you settle from outside. |

## What "clean" means

`app.probe()` counts plugins, scopes, services, hooks (observers included), registry entries and subscribers, and the
Cordis fibers still tracked. After `stop()` every counter is zero. A plugin that forgets to release a timer will not show
up here (a timer is not an AIMBRACE resource), but one that registers through `ctx` can never leak, and `ctx.own` makes the
rest explicit. If your plugin holds an external resource, assert on it too in the test.

## Patterns

- **Stub a dependency**: `mockService(Model, fakeModel)` instead of the real provider plugin.
- **Test the ordering**: `recordHooks(app)` then compare `names()` to the sequence you expect.
- **Test the failure path**: a plugin whose `setup` throws, then `await expect(withApp(...)).rejects`; `withApp` has already
  rolled back.
- **Test reactivation**: install the provider with `app.install`, dispose its handle, and `waitFor` the dependent to be `pending`.
- **Test cancellation**: pass an `AbortSignal` (or use a scope) and assert the work stopped and `probe().scopes` is 0.

## Testing a CLI command or a route without a host

Commands and routes are registry entries, so test them without a process or a socket:

- Routes: install `http` and the route plugin, then call `app.get(HttpDispatcher).dispatch(new Request('http://test/path'))`.
- Commands: call `runCli([...], { stdout, stderr, cwd })`; it returns the exit code and never calls `process.exit`.
