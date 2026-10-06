# Quickstart

This page builds a small app: a settings plugin, a greeter that depends on it, and a task scope. Every
snippet marked as runnable is executed by the test suite.

## 1. Services are typed tokens

A service is a typed handle. The type exists only at compile time.

```ts docs-test
import assert from 'node:assert/strict'
import { service } from '@aimbrace/core'

interface Settings {
  name: string
}
interface Greeter {
  greet(who: string): string
}

export const Settings = service<Settings>('settings')
export const Greeter = service<Greeter>('greeter')

assert.equal(Settings.name, 'settings')
assert.equal(Greeter.kind, 'service')
```

## 2. Plugins declare what they require and provide

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, service } from '@aimbrace/core'

interface Settings {
  name: string
}
interface Greeter {
  greet(who: string): string
}
const Settings = service<Settings>('settings')
const Greeter = service<Greeter>('greeter')

const settings = definePlugin({
  id: 'settings',
  provides: [Settings],
  setup(ctx) {
    ctx.provide(Settings, { name: 'AIMBRACE' })
  },
})

const greeter = definePlugin({
  id: 'greeter',
  requires: [Settings],
  provides: [Greeter],
  setup(ctx) {
    const { name } = ctx.get(Settings) // only what was declared in `requires` type-checks
    ctx.provide(Greeter, { greet: (who) => `Hello ${who}, from ${name}!` })
  },
})

// The order of the list does not matter: the graph decides.
const app = createApp({ plugins: [greeter, settings] })
await app.start()

assert.equal(app.get(Greeter).greet('world'), 'Hello world, from AIMBRACE!')
assert.deepEqual(app.graph().order, ['settings', 'greeter'])

await app.stop()
assert.equal(app.probe().clean, true) // nothing leaked
```

Three things just happened that you did not write:

1. `greeter` was installed after `settings`, derived from `requires` and `provides`.
2. `ctx.get(Greeter)` is typed. Asking a plugin context for a service it did not declare is a **compile error**
   (and a runtime `UndeclaredAccessError`).
3. `app.stop()` released everything in reverse order, and `app.probe()` proves it.

## 3. See the graph

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, service } from '@aimbrace/core'

const Settings = service<{ name: string }>('settings')
const Greeter = service<{ greet(who: string): string }>('greeter')

const app = createApp({
  plugins: [
    definePlugin({ id: 'greeter', requires: [Settings], provides: [Greeter] }),
    definePlugin({ id: 'settings', provides: [Settings] }),
  ],
})

assert.equal(
  app.graph().toText(),
  [
    'Plugin graph: 2 plugins, order settings -> greeter',
    '1. settings',
    '     provides settings',
    '2. greeter',
    '     requires settings (from settings)',
    '     provides greeter',
  ].join('\n'),
)
assert.match(app.graph().toMermaid(), /p_settings -->\|settings\| p_greeter/)
```

The same graph is available as Mermaid, Graphviz DOT and JSON, from the CLI (`aimbrace graph`) and at build
time ([build-time graph](../guides/build-time-graph.md)).

## 4. Mistakes fail before anything runs

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, MissingDependencyError, service } from '@aimbrace/core'

const Model = service<unknown>('model')
const agent = definePlugin({
  id: 'agent',
  requires: [Model],
  setup() {
    throw new Error('never runs')
  },
})

const app = createApp({ plugins: [agent] })
const error = await app.start().catch((e: unknown) => e)

assert.ok(error instanceof MissingDependencyError)
assert.equal(error.plugin, 'agent')
assert.equal(error.service, 'model')
assert.equal(app.probe().clean, true)
```

## 5. A scope per task

A **scope** is a child context with its own signal and resources. Opening one per task, and disposing it
afterwards, is how work stays leak-free. See [Scopes](../concepts/scopes.md).

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, service } from '@aimbrace/core'

const Budget = service<{ tokens: number }>('budget')

const app = createApp()
await app.start()

await using task = await app.scope('task:42')
task.provide(Budget, { tokens: 1000 })
assert.equal(task.get(Budget).tokens, 1000)
assert.equal(app.probe().scopes, 1)
```

## Where next

- [Overview](../concepts/overview.md) for the model in your head
- [Write a plugin](../guides/write-a-plugin.md) for the rules that keep plugins well behaved
- [AI agents](../guides/ai-agents.md) for the full worked example with a model, tools, memory and an agent
