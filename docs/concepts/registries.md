# Registries

A **registry** is a typed collection many plugins contribute to and many plugins read, without knowing about each
other. Tools, routes, commands, model providers and middleware are all registries.

```text
Plugin A --+
Plugin B --+--> Registry<Tool> <-- Plugin C reads all
Plugin D --+
```

This replaces plugin-to-plugin coupling (`A -> B -> C -> D`) with one shared, typed seam.

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, registry } from '@aimbrace/core'

interface Tool {
  name: string
  run(): string
}
const Tools = registry<Tool>('tools', { key: (tool) => tool.name })

const search = definePlugin({
  id: 'search',
  setup: (ctx) => void ctx.registry(Tools).add({ name: 'search', run: () => 'found' }),
})
const files = definePlugin({
  id: 'files',
  setup(ctx) {
    ctx.registry(Tools).add({ name: 'read', run: () => 'contents' })
    ctx.registry(Tools).add({ name: 'write', run: () => 'ok' })
  },
})

const app = createApp({ plugins: [files, search] })
await app.start()

const tools = app.registry(Tools)
assert.deepEqual(tools.all().map((t) => t.name), ['read', 'write', 'search']) // insertion order
assert.equal(tools.get('read')?.run(), 'contents')

// Disposing a contributor removes only its entries.
const late = await app.install(
  definePlugin({ id: 'late', setup: (ctx) => void ctx.registry(Tools).add({ name: 'late', run: () => 'x' }) }),
)
assert.equal(tools.size, 4)
await late.dispose()
assert.equal(tools.size, 3)

await app.stop()
assert.equal(app.probe().registryEntries, 0)
```

## Tokens and views

`registry<T>(name, { key?, description? })` creates a token. A **view** (`ctx.registry(token)`,
`scope.registry(token)`, `app.registry(token)`) reads and writes the collection. Entries added through a view are
**owned by its context**: when the plugin, scope or app ends, they are removed.

| Member | Purpose |
|---|---|
| `add(item)` | Add; returns a function that removes exactly this entry. |
| `all()` | A frozen snapshot in insertion order. |
| `get(id)`, `has(id)` | By id, when the token has a `key` function. |
| `size`, iteration | Count and `for...of`. |
| `subscribe(listener)` | Be told about `add` and `remove`; returns the unsubscribe function. Owned like entries. |

A `key` makes ids unique: adding a second entry with the same id throws `DuplicateRegistryEntryError`. Tokens with the
same name address the same collection.

## Reading live

Always read a registry at the moment you need it (`registry.all()`), not once at startup. Then providers and tools
that come and go at runtime are seen, which is exactly how the HTTP dispatcher, the tool runner and the model router
work.

## Events

Every change also fires the `registry:change` hook with `{ type, registry, item, id }`, so a tracing plugin can watch
every registry in the app. See [Hooks](hooks.md).

## Examples in the box

| Registry | Package | Contributors |
|---|---|---|
| `Routes`, `Middlewares` | `@aimbrace/http` | route and middleware plugins |
| `Commands` | `@aimbrace/cli` | command plugins |
| `ModelProviders` | `@aimbrace/plugin-model` | provider plugins |
| `Tools` | `@aimbrace/plugin-tools` | tool plugins |
