# The dependency graph

The graph is the product of `requires`, `optional`, `provides` and `peers`. It is **pure data**: building it runs no
plugin code, so the CLI, the build-time plugin and the website can all use it.

```ts docs-test
import assert from 'node:assert/strict'
import { buildGraph } from '@aimbrace/core'

// buildGraph works on plain objects, so it can run from JSON.
const graph = buildGraph([
  { id: 'agent', version: '1.0.0', requires: ['model', 'memory'], optional: ['tracing'], provides: ['agent'] },
  { id: 'memory', requires: [], optional: [], provides: ['memory'] },
  { id: 'openai/model', version: '2.1.0', requires: [], optional: [], provides: ['model'] },
])

assert.equal(graph.ok, true)
assert.deepEqual(graph.order, ['memory', 'openai/model', 'agent'])
assert.deepEqual(graph.dependenciesOf('agent'), ['openai/model', 'memory'])
assert.deepEqual(graph.dependentsOf('memory'), ['agent'])
assert.deepEqual(graph.diagnostics.map((d) => d.code), ['I_OPTIONAL_MISSING'])
```

## Ordering

Installation order is a topological order of the required dependencies. Ties are broken by **registration order**,
so the result is deterministic: the same list always gives the same order. Start follows that order; stop and
disposal use the reverse.

## Validation

`buildGraph` reports problems as diagnostics; `graph.assertValid()` and `app.start()` throw them (one problem: its
own error class; several: an aggregate). Nothing is installed when the graph is invalid.

| Problem | Error | Code |
|---|---|---|
| A required service has no provider | `MissingDependencyError` (with typo suggestions) | `E_MISSING_DEPENDENCY` |
| Two plugins provide the same service | `DuplicateProviderError` | `E_DUPLICATE_PROVIDER` |
| Two plugins share an id | `DuplicatePluginError` | `E_DUPLICATE_PLUGIN` |
| Required dependencies form a cycle, including `requires` of what you `provide` | `DependencyCycleError` (with the path) | `E_DEPENDENCY_CYCLE` |
| A peer plugin is absent | `PeerError` | `E_MISSING_PEER` |
| A peer's version does not satisfy the range | `PeerError` | `E_PEER_VERSION` |
| A peer range is not valid | `PeerError` | `E_INVALID_RANGE` |
| Several problems at once | `GraphValidationError` | `E_GRAPH_INVALID` |

```ts docs-test
import assert from 'node:assert/strict'
import { buildGraph, DependencyCycleError, MissingDependencyError } from '@aimbrace/core'

const meta = (id: string, requires: string[] = [], provides: string[] = []) => ({ id, requires, optional: [], provides })

const missing = buildGraph([meta('agent', ['modle']), meta('openai', [], ['model'])])
const error = missing.errors[0]
assert.ok(error instanceof MissingDependencyError)
assert.deepEqual(error.suggestions, ['model']) // a typo hint

const cyclic = buildGraph([meta('a', ['b'], ['a']), meta('b', ['c'], ['b']), meta('c', ['a'], ['c'])])
const cycle = cyclic.errors[0]
assert.ok(cycle instanceof DependencyCycleError)
assert.equal(cycle.message, 'Dependency cycle: a -> b -> c -> a.')
assert.deepEqual(cyclic.order, []) // no order for an invalid graph
```

## Optional dependencies

An `optional` service orders its provider first when one exists, and is simply absent when none does (an
`I_OPTIONAL_MISSING` info diagnostic). If an optional edge would **close a cycle**, it is dropped with a
`W_OPTIONAL_CYCLE_DROPPED` warning instead of failing: required edges win.

## Peers and versions

`peers: { logger: '^1.2.0' }` needs a registered plugin `logger` whose `version` satisfies the range. Peers affect
validity, not ordering. The built-in semver subset supports exact versions, partial versions (`1`, `1.2`, `1.x`, `*`),
carets, tildes, `>=`, `>`, `<=`, `<`, `=`, AND by space and OR with `||`. It follows the npm rule for prereleases.
Hyphen ranges and build metadata semantics are not supported.

## External services

`buildGraph(metas, { external: [...] })` treats the listed services as already provided. The runtime uses this idea
for dynamic installs, and tools can use it to check a plugin set that expects services from the host.

## Exporters

```ts docs-test
import assert from 'node:assert/strict'
import { buildGraph } from '@aimbrace/core'

const graph = buildGraph([
  { id: 'db', requires: [], optional: [], provides: ['database'] },
  { id: 'api', requires: ['database'], optional: [], provides: [] },
])

assert.ok(graph.toText().startsWith('Plugin graph: 2 plugins, order db -> api'))
assert.ok(graph.toMermaid().includes('p_db -->|database| p_api'))
assert.ok(graph.toDot().startsWith('digraph aimbrace {'))
assert.equal(JSON.parse(JSON.stringify(graph)).order[0], 'db')
```

- `toText()` lists plugins in installation order with their edges and diagnostics.
- `toMermaid()` is a flowchart; dashed arrows are optional dependencies. Paste it into any Mermaid renderer.
- `toDot()` is Graphviz.
- `toJSON()` is serialisable; error objects are replaced by their message and code.

Where to get a graph: `app.graph()` (static, before and after start), `aimbrace graph` ([CLI](../guides/cli.md)),
and the virtual module `virtual:aimbrace/graph` ([build-time graph](../guides/build-time-graph.md)).

## Performance

The build is linear in plugins plus edges (iterative Tarjan for cycles, a binary heap for ordering). A chain of 1,000
plugins builds in well under 200 ms; a test enforces it.

## What the static graph does not cover

Plugins installed from inside `setup` (`ctx.install`) or after start (`app.install`) are not part of the static
graph. They are checked when they are installed and appear in the observed tree (`app.inspect()`). See
[Isolation and nesting](isolation-and-nesting.md).
