# @aimbrace/core

Services, plugins, registries, hooks, scopes, lifecycle and the dependency graph. Runtime dependencies: `cordis`, `hookable`.
No Node-only API. Concepts: [Overview](../concepts/overview.md).

```ts
import { createApp, definePlugin, service, registry } from '@aimbrace/core'
```

## Apps

### `createApp(options?)`

```ts
createApp({ name?, plugins?, onError? }): App
```

| Option | |
|---|---|
| `name` | shown in snapshots; default `app` |
| `plugins` | plugins or configured instances to register |
| `onError(error, where)` | receives errors with no caller to throw to; default `console.error` |

### `App`

| Member | |
|---|---|
| `name`, `state` | `created`, `starting`, `running`, `stopping`, `stopped`, `failed` |
| `hooks` | `Hooks<AppHooks>`, the typed hook map |
| `signal` | aborts when the app begins stopping |
| `use(...plugins)` | register before start; chainable. `AppStateError` after start |
| `validate()` | `{ ok, graph, errors }`; checks graph and configs, runs no `setup` |
| `start()` | validate, install in order, start; rolls back on failure |
| `stop()` | stop in reverse, dispose, idempotent |
| `install(plugin, config?, options?)` | install into a running app; returns a `PluginHandle` |
| `get(token)`, `maybe(token)` | read a service |
| `registry(token)` | a registry view owned by the app |
| `scope(name, options?)` | open a [scope](../concepts/scopes.md) (running apps only) |
| `graph()` | the static `Graph` |
| `inspect()` | `AppSnapshot`: plugins (key, id, version, state, parent, provides, error), scopes, services, registries, hook count |
| `probe()` | `LeakProbe`: plugins, scopes, services, hooks, registryEntries, registrySubscribers, fibers, `clean` |
| `[Symbol.asyncDispose]()` | same as `stop()` |

Types: `App`, `AppOptions`, `AppState`, `AppSnapshot`, `PluginSnapshot`, `ScopeSnapshot`, `LeakProbe`, `ValidationReport`.

## Plugins

### `definePlugin(definition)`

Returns a frozen, callable `Plugin`. `requires`, `optional` and `provides` are inferred as exact tuples. See [Plugins](../concepts/plugins.md)
for every field. A plugin has `kind: 'plugin'`, `id`, `version`, `description`, `meta` (plain data), `tokens` and `definition`; calling it with a config returns a
`PluginInstance`.

### `isPlugin(value)`, `isPluginInstance(value)`, `resolvePluginLike(like, config?)`

Type guards and the normalisation of a plugin or instance into `{ plugin, config }`.

Types: `Plugin`, `PluginDefinition`, `PluginInstance`, `PluginLike`, `PluginRecord`, `PluginMeta`, `ServiceList`, `SetupResult`, `ConfigSchema`, `ConfigOf`, `ConfigInputOf`.

### Contexts

`PluginContext<R, O, P>` (limited `get`, `maybe`, `provide` plus `pluginId`), `BaseContext` (`name`, `signal`, `hooks`, `registry`, `scope`, `install`,
`own`, `report`), `Scope`, `ScopeOptions`, `InstallOptions` (`isolate`), `PluginHandle` (`id`, `state`, `dispose()`), `PluginState`, `PluginInfo`, `ScopeInfo`.
These are interfaces; the implementations are internal.

## Services

### `service<T>(name, options?)`

A typed token `{ kind: 'service', name, description }`. `isServiceToken(value)` is the guard. Types: `ServiceToken<T>`, `ValueOf<S>`, `ServiceOptions`.

## Registries

### `registry<T>(name, options?)`

A token `{ kind: 'registry', name, description, key }`; `options.key(item)` makes ids unique. `isRegistryToken(value)` is the guard.

### `RegistryStore`

Holds the entries of every registry in one app. `view(token, owner?)` returns a `Registry<T>` (`add`, `all`, `get`, `has`, `size`, `subscribe`, iteration); entries and
subscriptions made through a view with an `owner` end with it. `total()`, `sizes()`, `subscribers()` are the leak counters. You rarely construct one: the app owns it.

Types: `RegistryToken`, `Registry`, `RegistryEvent`, `RegistryOptions`, `RegistryStoreOptions`, `ItemOf`.

## Hooks

### `Hooks<T>`

A typed hook map over Hookable: `hook(name, fn)`, `hookOnce`, `callHook(name, ...args)` (serial), `callHookParallel`, `beforeEach`, `afterEach`, `count(name?)`,
`names()`, `observed()`, `clear()`, `scoped(owner)`. Every `hook*` returns an unregister function. `callHook` always returns a promise.

### `ScopedHooks<T>`

A `Hooks` view bound to an `Owner`: registrations vanish with the owner.

Types: `AppHooks`, `CoreHooks`, `HookExtensions` (merge point), `HookShape`, `HookName`, `HookEvent`, `Unhook`. See [Hooks](../concepts/hooks.md) for every core hook.

## Resources

### `DisposerStack`

A last-in first-out stack of disposers. `own(fn)` and `push(fn)` add (returning a function that forgets it), `dispose()` runs newest first, continues past failures and throws one
`DisposalError`, and is idempotent; `size`, `disposed`; implements `Symbol.asyncDispose`. Types: `Disposer`, `Owner` (`own(disposer)`).

## The graph

### `buildGraph(metas, options?)`

Pure. Takes `PluginMeta[]` in registration order, `options.external` is a list of already-available service names. Returns a `Graph`.

### `Graph`

`nodes`, `edges` (provider to dependent, with `optional`), `order`, `diagnostics`, `ok`, `errors`, `assertValid()`, `node(id)`, `dependenciesOf(id)`, `dependentsOf(id)`,
`toText()`, `toMermaid()`, `toDot()`, `toJSON()`. See [The dependency graph](../concepts/dependency-graph.md).

### `peerProblem(owner, peer, range, found)`, `suggestNames(wanted, known)`

Building blocks used by the graph and by dynamic installs: one peer check, and typo suggestions.

Types: `BuildGraphOptions`, `GraphNode`, `GraphEdge`, `GraphDiagnostic`.

## Versions

A small semver subset: `parseVersion(text)`, `compareVersions(a, b)`, `satisfies(version, range)`, `isValidRange(range)`. Type: `Version`. Supports exact and partial versions,
`^`, `~`, `>=`, `>`, `<=`, `<`, `=`, AND by space, OR with `||`, and the npm prerelease rule. Not supported: hyphen ranges.

## Config

### `validateStandard(schema, value, subject)`

Validates with any [Standard Schema](https://standardschema.dev) (sync or async) and returns the parsed output or throws `ConfigError`. Types: `StandardSchemaV1`,
`StandardSchemaProps`, `StandardSchemaResult`, `StandardSchemaIssue`, `SchemaInput`, `SchemaOutput`. The interface is vendored so the core needs no validation library.

## Errors

All extend `AimbraceError` (`code`, optional `cause`). The full table with causes and fixes is the [error catalogue](../guides/errors.md).

| Class | Extra fields |
|---|---|
| `AimbraceError` | `code` |
| `InvalidNameError` | |
| `DisposedError` | |
| `DisposalError` | `errors` |
| `DuplicateRegistryEntryError` | |
| `ConfigError` | `subject`, `issues` (`{ message, path }`) |
| `DuplicatePluginError` | `id` |
| `DuplicateProviderError` | `service`, `providers` |
| `MissingDependencyError` | `plugin`, `service`, `suggestions` |
| `DependencyCycleError` | `cycle` |
| `PeerError` | `plugin`, `peer`, `range`, `found` |
| `GraphValidationError` | `errors` |
| `PluginError` | `plugin`, `phase` (`config`, `install`, `start`, `stop`, `dispose`) |
| `UndeclaredAccessError` | `plugin`, `service` |
| `MissingServiceError` | `service` |
| `UnfulfilledProvideError` | `plugin`, `services` |
| `DuplicateProvideError` | `service` |
| `InvalidServiceValueError` | `service` |
| `AppStateError` | `state` |
| `StartupValidationError` | `errors` |

Types: `ConfigIssue`, `PluginPhase`.
