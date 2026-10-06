# Services and tokens

A **service** is a capability other plugins depend on: a database connection, a model client, a logger. Services
are identified by **tokens**.

```ts docs-test
import assert from 'node:assert/strict'
import { service, type ValueOf } from '@aimbrace/core'

interface Database {
  query(sql: string): string[]
}

const Database = service<Database>('database', { description: 'SQL access' })

type Value = ValueOf<typeof Database> // Database
const value: Value = { query: () => [] }

assert.equal(Database.name, 'database')
assert.equal(Database.description, 'SQL access')
assert.ok(Object.isFrozen(Database))
assert.deepEqual(value.query('select 1'), [])
```

## What a token is

A token is a small frozen object: `{ kind: 'service', name, description }`. The value type `T` exists only for the
compiler (a phantom property). Tokens are cheap; create them at module level and export them from the plugin
package that owns the capability.

## Names

A name matches `^[A-Za-z][A-Za-z0-9._:/-]*$`, so namespaced names work (`acme/db:primary.v2`). An invalid name
throws `InvalidNameError` when the token is created.

The name is the identity at runtime. Two tokens with the same name in one app refer to the same service. Under the
hood the Cordis service name is `aimbrace:<name>`, which cannot collide with Cordis built-ins such as `events` or
`logger`.

## Typed access

`definePlugin` infers exact tuples from `requires`, `optional` and `provides`. Inside `setup`, `start` and `stop`:

| Call | Allowed for |
|---|---|
| `ctx.get(Token)` | tokens listed in `requires` |
| `ctx.maybe(Token)` | tokens listed in `optional`; returns `undefined` when absent |
| `ctx.provide(Token, value)` | tokens listed in `provides`, with the right value type |

Anything else is a compile error. The runtime enforces the same rule (`UndeclaredAccessError`), so plain
JavaScript gets the guarantee too.

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, PluginError, service, UndeclaredAccessError } from '@aimbrace/core'

const Settings = service<{ debug: boolean }>('settings')

const sneaky = definePlugin({
  id: 'sneaky',
  setup(ctx) {
    // @ts-expect-error `settings` was not declared in `requires`
    ctx.get(Settings)
  },
})

const error = await createApp({ plugins: [sneaky] })
  .start()
  .catch((e: unknown) => e)

assert.ok(error instanceof PluginError)
assert.ok(error.cause instanceof UndeclaredAccessError)
```

The compiler message for the type error is accurate but not friendly (`Argument of type 'ServiceToken<...>' is not
assignable to ...`). Read it as "this plugin did not declare that service".

## Rules for values

- A service value cannot be `null` or `undefined` (`InvalidServiceValueError`).
- A declared service must be provided exactly once per activation, in `setup` (`DuplicateProvideError`,
  `UnfulfilledProvideError`). It must be provided during `setup`, not later, because dependents are installed as
  soon as `setup` finishes.
- Two plugins cannot provide the same service in one namespace (`DuplicateProviderError` at graph time).
  Replacement of a provider is done by removing the old one, see [Lifecycle](lifecycle.md#provider-replacement-and-reactivation).

## A limitation to know

Tokens carry only their value type, not a name literal. When you bridge to Effect ([Effect interop](../guides/effect-interop.md)),
two tokens whose value types are identical are indistinguishable to the Effect type checker, although their runtime
keys differ.
