# Scopes

Cordis's central idea is that a context changes through time. A **scope** is that idea made explicit for the work an
app does at runtime: one agent task, one HTTP request, one CLI command.

```text
App
 `-- task:42                       a Scope
      |-- signal                   aborts when the scope ends
      |-- budget, task memory      scope-local services
      |-- registry entries, hooks  released with the scope
      `-- child scopes             end first
```

Opening a scope is cheap. Ending it releases everything it owns, in reverse order, even when the work failed or was
cancelled.

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, service } from '@aimbrace/core'

const Budget = service<{ tokens: number }>('budget')
const app = createApp()
await app.start()

const log: string[] = []
const task = await app.scope('task:42')
task.signal.addEventListener('abort', () => log.push('abort'))
task.provide(Budget, { tokens: 100 })
task.own(() => void log.push('release resource'))

assert.equal(task.get(Budget).tokens, 100)
assert.equal(app.maybe(Budget), undefined) // the app does not see it
assert.equal(app.probe().scopes, 1)

await task.dispose()

assert.deepEqual(log, ['abort', 'release resource']) // abort first, then resources
assert.equal(task.disposed, true)
assert.equal(app.probe().scopes, 0)
await app.stop()
```

## Opening a scope

| From | Lifetime ends with |
|---|---|
| `app.scope(name)` | the scope, or the app stopping |
| `ctx.scope(name)` inside a plugin | the scope, or the plugin being disposed |
| `scope.scope(name)` | the scope, or the parent scope ending (children end first) |

Options: `{ signal }`, an outside `AbortSignal`. When it aborts the scope is disposed. If it is already aborted, or
aborts while the scope is still opening, opening rejects with the abort reason and leaves nothing behind.

## What a scope offers

| Member | Purpose |
|---|---|
| `signal` | Aborted when the scope ends. Pass it to `fetch`, to tools, to anything cancellable. |
| `provide(token, value)` | A scope-local service; returns a function that removes it early. |
| `get(token)`, `maybe(token)` | Read: this scope, then parent scopes, then the app's services. |
| `own(disposer)` | Release something when the scope ends. |
| `hooks`, `registry(token)` | Registrations that vanish with the scope. |
| `install(plugin, config?, options?)` | Install a plugin that ends with the scope. |
| `run(fn)` | Run `fn(scope)`, then dispose the scope, also when `fn` throws. |
| `dispose()` | End the scope. Idempotent. |
| `id`, `name`, `disposed` | Identity and state. |

A scope implements `Symbol.asyncDispose`, so `await using scope = await app.scope('task')` works.

## Local services are a chain

`scope.provide` stores a value in the scope itself. Lookup walks the chain: the scope, its parent scopes, then the app's
services. Sibling scopes are fully independent, so you can provide `Budget` in a thousand concurrent task scopes
without clashing, and a child can shadow its parent.

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, service } from '@aimbrace/core'

const Level = service<number>('level')
const app = createApp()
await app.start()

const outer = await app.scope('outer')
outer.provide(Level, 1)
const inner = await outer.scope('inner')
assert.equal(inner.get(Level), 1) // inherited
inner.provide(Level, 2)
assert.equal(inner.get(Level), 2) // shadowed
assert.equal(outer.get(Level), 1) // untouched

const results = await Promise.all(
  [1, 2, 3].map((n) =>
    app.scope(`sibling:${n}`).then((scope) => {
      scope.provide(Level, n * 10)
      return scope.get(Level)
    }),
  ),
)
assert.deepEqual(results, [10, 20, 30])

await outer.dispose() // disposes inner first
assert.equal(inner.disposed, true)
await app.stop()
assert.equal(app.probe().clean, true)
```

Why a chain and not Cordis services: Cordis scopes a service by isolating it *before* the fiber that provides or
consumes it exists, which cannot express "open a scope now, provide a task-local value later, concurrently, in many
siblings". Scope-local values are plain context-local state (comparable to `AsyncLocalStorage`), not a second
dependency-injection container. They are not injectable into plugins; plugins installed into a scope still use real
Cordis injection. See [Decisions](../architecture/decisions.md#r7-scope-local-values-are-a-plain-chain-not-cordis-services).

## `run` and `await using`

```ts docs-test
import assert from 'node:assert/strict'
import { createApp } from '@aimbrace/core'

const app = createApp()
await app.start()

const result = await (await app.scope('job')).run(async (scope) => {
  assert.equal(scope.disposed, false)
  return 7
})
assert.equal(result, 7)

await assert.rejects(
  (await app.scope('failing')).run(() => {
    throw new Error('job failed')
  }),
  /job failed/,
)
assert.equal(app.probe().scopes, 0) // both scopes ended, one by failure

await app.stop()
```

## Cancellation

The scope signal is the one cancellation channel. Anything holding it stops when the scope ends: an HTTP request that
disconnects, a task cancelled by its caller, an app that begins stopping (the app signal aborts first, then open
scopes end). The agent example shows all three: `agent.run(input, { signal })`, `agent.cancel(id)` and app shutdown all end the
task scope and interrupt the model call and tool calls in flight.

## Scopes in the hosts

- The HTTP dispatcher opens `request:<id>` per request and disposes it only after the response body is fully read or
  cancelled, so streaming responses keep their scope. See [HTTP hosts](../guides/http-hosts.md).
- The CLI runs a plugin command inside `command:<name>`. See [the CLI](../guides/cli.md).
- The agent runs each task in `task:<id>` with a `Budget` and a `TaskMemory`. See [AI agents](../guides/ai-agents.md).
