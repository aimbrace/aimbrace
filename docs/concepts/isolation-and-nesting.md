# Isolation and nesting

Most plugins form one flat graph. Sometimes a plugin needs a **subtree**: a group that installs its own children and
keeps some of their services private. That is Fastify's encapsulation, built on Cordis `isolate`.

## Nested plugins

`ctx.install(plugin, config?, options?)` inside `setup` installs a child plugin that is part of the parent's lifetime.
The parent starts before its children and stops after them; disposing the parent disposes the children first.

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin } from '@aimbrace/core'

const log: string[] = []
const child = (id: string) =>
  definePlugin({ id, stop: () => void log.push(`stop ${id}`), setup: () => () => void log.push(`dispose ${id}`) })

const parent = definePlugin({
  id: 'parent',
  async setup(ctx) {
    await ctx.install(child('c1'))
    await ctx.install(child('c2'))
  },
  stop: () => void log.push('stop parent'),
})

const app = createApp({ plugins: [parent] })
await app.start()
assert.deepEqual(app.inspect().plugins.map((p) => p.key), ['parent', 'parent/c1', 'parent/c2'])

await app.stop()
assert.deepEqual(log, ['stop c2', 'stop c1', 'stop parent', 'dispose c2', 'dispose c1'])
```

Nested plugins appear in `app.inspect()` with a path key (`parent/c1`). A nested install that fails is reported as the
child's failure (`PluginError.plugin` is the child) and fails the parent's `setup`.

## Isolating services

`ctx.install(plugin, config, { isolate: [Token] })` gives the installed subtree **its own namespace** for the listed
services: providers and consumers inside see their own copy, nothing outside sees it, and two subtrees can each provide
the same service.

Isolation applies to the plugin you install and everything installed under it, so install a **group** plugin
with `isolate` and let the group install its members:

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, service } from '@aimbrace/core'

const Db = service<{ id: string }>('db')
const seen: string[] = []

function tenant(id: string, database: string) {
  const privateDb = definePlugin({
    id: 'private-db',
    provides: [Db],
    setup: (ctx) => void ctx.provide(Db, { id: database }),
  })
  const reader = definePlugin({
    id: 'reader',
    requires: [Db],
    setup: (ctx) => void seen.push(`${id} reads ${ctx.get(Db).id}`),
  })
  return definePlugin({
    id,
    async setup(ctx) {
      await ctx.install(privateDb)
      await ctx.install(reader)
    },
  })
}

const app = createApp()
await app.start()
await app.install(tenant('acme', 'db-acme'), undefined, { isolate: [Db] })
await app.install(tenant('globex', 'db-globex'), undefined, { isolate: [Db] })

assert.deepEqual(seen, ['acme reads db-acme', 'globex reads db-globex'])
assert.equal(app.maybe(Db), undefined) // invisible outside the subtrees
assert.equal(app.inspect().services.filter((s) => s.service === 'db').length, 2)

await app.stop()
assert.equal(app.probe().clean, true)
```

## What is and is not checked

- The **static graph** covers the plugins registered at the root. Nested and dynamically installed plugins are not part
  of it; they are validated when installed, against what is visible from where they are installed.
- Requirements on a service you isolate are resolved dynamically: the plugin stays `pending` until something inside the
  subtree provides it.
- Visibility is asked of Cordis, so isolation is respected by `DuplicateProviderError` and `MissingDependencyError`
  checks too.

## Handles

`ctx.install` and `app.install` return a handle `{ id, state, dispose() }`. Disposing the handle stops and removes the
plugin (and its nested plugins) early.
