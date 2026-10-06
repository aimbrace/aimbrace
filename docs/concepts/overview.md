# Overview

> Do not create "another plugin framework". Create a TypeScript application composition runtime.

That sentence from the [original brief](../aimbrace_spec.md) is the design goal. A plugin framework lets you
register functions. A composition runtime knows the **dependency graph** of what you registered, and uses it.

## The model

```text
Plugin
  requires   services it needs
  provides   services it makes available
  hooks      what it observes
        |
        v
     Context --- Scope --- Registry --- Lifecycle
```

- **Service**: a typed token for a capability (`Database`, `Model`). See [Services and tokens](services-and-tokens.md).
- **Plugin**: a declarative unit that requires, provides and hooks. See [Plugins](plugins.md).
- **Graph**: derived from the declarations, validated before anything runs. See [The dependency graph](dependency-graph.md).
- **Lifecycle**: install and start in dependency order, stop and dispose in reverse. See [Lifecycle](lifecycle.md).
- **Scope**: a short-lived context for a task or request. See [Scopes](scopes.md).
- **Registry**: a collection many plugins contribute to. See [Registries](registries.md).
- **Hooks**: typed events, with automatic cleanup. See [Hooks](hooks.md).

## The layers

```text
 APPLICATION   your product: an agent, a CLI, a web service
 PLUGINS       model, memory, tools, agent, your own
 HOSTS         http (Hono, Fastify), cli, effect, unplugin (build time)
 ENGINE        loader (config, manifests), testing
 CORE          service, plugin, registry, hooks, scope, lifecycle, graph
 SUBSTRATE     cordis (Context, fibers, isolate, effects), hookable, Web primitives
```

## What the core refuses to know

`@aimbrace/core` has no idea what a model vendor, a database, an HTTP server, a CLI or an agent is. A test
(`packages/core/test/boundaries.test.ts`) scans its sources: it may import only `cordis` and `hookable`, no Node
module, and it may not even name a vendor. Everything concrete is a plugin or a host adapter.

## Built on Cordis, not beside it

Every plugin is a Cordis fiber, services are Cordis `provide`/`inject`, isolation is Cordis `isolate`, disposal
is Cordis effects. AIMBRACE adds a typed, declarative layer and the guarantees Cordis does not make by itself
(for example "stop in the reverse of the start order"; see [Decisions](../architecture/decisions.md)).

## Borrowed ideas

| From | The idea | Where it shows |
|---|---|---|
| Cordis | Context, services, fibers, isolation, effects | the whole runtime |
| Effect | typed requirements, layers, scoped resources | `PluginContext` types, [Effect interop](../guides/effect-interop.md) |
| Fastify | plugin graph, ordering, encapsulation, version peers | [the graph](dependency-graph.md), [nesting](isolation-and-nesting.md) |
| Hookable | typed hooks, serial and parallel dispatch | [Hooks](hooks.md) |
| Unplugin | one plugin, many adapters | [Hosts](hosts.md), [build-time graph](../guides/build-time-graph.md) |
| Hono | minimal runtime-neutral core, Web `Request` and `Response` | [HTTP hosts](../guides/http-hosts.md) |

More in [Comparison](../architecture/comparison.md).

## What it is not

- Not a web framework. HTTP is one host among several.
- Not a dependency-injection container with decorators. There are no decorators, no reflection metadata, no codegen.
- Not a state store. There is no global mutable singleton; two apps in one process share nothing.
