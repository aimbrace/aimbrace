# Error catalogue

Every error AIMBRACE throws extends `AimbraceError` and carries a stable `code`, so tools and tests can match on it
instead of parsing messages. (`HttpError` is the one deliberate exception: it is a response, not a failure of the framework.)

```ts docs-test
import assert from 'node:assert/strict'
import { AimbraceError, createApp, definePlugin, MissingDependencyError, service } from '@aimbrace/core'

const error = await createApp({ plugins: [definePlugin({ id: 'a', requires: [service('ghost')] })] })
  .start()
  .catch((e: unknown) => e)

assert.ok(error instanceof AimbraceError)
assert.ok(error instanceof MissingDependencyError)
assert.equal(error.code, 'E_MISSING_DEPENDENCY')
```

## Definition time

| Code | Class | Raised when | Fix |
|---|---|---|---|
| `E_INVALID_NAME` | `InvalidNameError` | a service, registry or plugin name does not match `^[A-Za-z][A-Za-z0-9._:/-]*$` | rename it |
| `E_INVALID_PLUGIN` | `AimbraceError` | `definePlugin` got a bad id, version, token list, a service listed twice, or one both required and optional | fix the declaration |

## Graph and start

| Code | Class | Raised when | Fix |
|---|---|---|---|
| `E_MISSING_DEPENDENCY` | `MissingDependencyError` | a required service has no provider (the message suggests close names) | add the provider plugin or fix the token name |
| `E_DUPLICATE_PROVIDER` | `DuplicateProviderError` | two plugins provide one service in the same namespace | keep one, or isolate the service in a subtree |
| `E_DUPLICATE_PLUGIN` | `DuplicatePluginError` | two plugins share an id (also for siblings at install time) | give them distinct ids |
| `E_DEPENDENCY_CYCLE` | `DependencyCycleError` | required dependencies form a cycle (`cycle` holds the path) | break the cycle; make one side `optional` or split a service |
| `E_MISSING_PEER` | `PeerError` | a peer plugin is not registered | register it |
| `E_PEER_VERSION` | `PeerError` | a peer's version does not satisfy the range | change the range or the version |
| `E_INVALID_RANGE` | `PeerError` | a peer range is not valid semver | fix the range |
| `E_GRAPH_INVALID` | `GraphValidationError` | several graph problems at once (`errors` lists them) | fix each |
| `E_CONFIG` | `ConfigError` | a plugin config failed its Standard Schema (`issues` has messages and dotted paths) | fix the config |
| `E_STARTUP_INVALID` | `StartupValidationError` | several validation problems (graph and config) at start | fix each |
| `E_APP_STATE` | `AppStateError` | an operation is not allowed in the app's state (`use` after start, `start` twice, `install` before start, ...) | an app is single-use: create a new one |

## Running plugins

| Code | Class | Raised when | Fix |
|---|---|---|---|
| `E_PLUGIN` | `PluginError` | a lifecycle function threw (`plugin`, `phase`, `cause`); for a nested plugin the failing child is named | read `cause` |
| `E_UNFULFILLED_PROVIDE` | `UnfulfilledProvideError` | `setup` finished without providing every service in `provides` | provide each declared service in `setup` |
| `E_UNDECLARED_ACCESS` | `UndeclaredAccessError` | `get`, `maybe` or `provide` on a token the plugin did not declare | add it to `requires`, `optional` or `provides` |
| `E_DUPLICATE_PROVIDE` | `DuplicateProvideError` | a service was provided twice in one plugin activation or scope | provide once |
| `E_INVALID_SERVICE_VALUE` | `InvalidServiceValueError` | a service value was `null` or `undefined` | provide a real value |
| `E_MISSING_SERVICE` | `MissingServiceError` | `get` of a service that is not available (or whose provider is not active) | check the provider; use `maybe` if it is optional |

## Resources

| Code | Class | Raised when | Fix |
|---|---|---|---|
| `E_DISPOSED` | `DisposedError` | something was added to, or a scope opened under, a lifetime that already ended | do not use a scope after disposing it |
| `E_DISPOSAL` | `DisposalError` | one or more disposers failed (`errors` lists them in order); every disposer still ran | fix the failing disposers |
| `E_DUPLICATE_REGISTRY_ENTRY` | `DuplicateRegistryEntryError` | a registry with a `key` got a second entry with the same id | use unique ids |

## Packages

| Code | Class | Package | Raised when |
|---|---|---|---|
| `E_LOADER` | `LoaderError` | `@aimbrace/loader` | a config file or plugin specifier cannot be read, found, imported or understood (`file`, `specifier`) |
| `E_LEAK` | `LeakError` | `@aimbrace/testing` | resources remained after `stop()` (`probe` has the counters) |
| `E_INVALID_COMMAND` | `AimbraceError` | `@aimbrace/cli` | a command name is not lower case letters, digits, `:` and `-` |
| `E_RESERVED_COMMAND` | `AimbraceError` | `@aimbrace/cli` | a plugin command reuses a built-in name |
| `E_NO_MODEL_PROVIDER` | `NoModelProviderError` | `@aimbrace/plugin-model` | no provider is registered, or the named one is not |

## Not errors

- A **tool call** never throws: failures are `ToolResult { isError: true }`.
- An **agent run** never throws for cancellation or budget: it returns a result with `status`.
- `HttpError(status, message)` thrown by a handler is mapped to that response.
- Errors with no caller to receive them (observer hooks, background teardown, a plugin that fails when it reactivates) go to the
  app's `onError(error, where)`; by default it logs to `console.error`.

## Reading a start failure

`PluginError.cause` holds what your code threw. `aimbrace run` prints the whole chain:

```text
error: Plugin "breaks" failed during install: cannot connect [E_PLUGIN]
caused by: cannot connect
```

Add `--debug` for stack traces.
