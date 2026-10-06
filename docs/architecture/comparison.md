# Comparison

What AIMBRACE took from each reference project, what it did not, and why. The original ranking is in the [brief](../aimbrace_spec.md).

## The six it is built from

| Project | Taken | Not taken |
|---|---|---|
| **Cordis** | Context, services, fibers (lifetime and reactivation), isolation, effects, inject-driven pending state | its global type augmentation for services; dynamic-only dependency resolution (a static graph was added); the assumption that Cordis alone orders shutdown |
| **Effect** | typed requirements (`ctx.get` only accepts declared tokens), the Layer idea (inputs and outputs), scoped resources and finalizers, memoised construction in `layerPlugin` | the whole effect system: AIMBRACE is not an effect runtime, it interoperates with one |
| **Fastify** | plugin graph, deterministic ordering, encapsulation (via `isolate`), version peers, load/start/close ordering | route-level hooks and schema validation (HTTP is one host, not the core); `fastify-plugin`'s "break encapsulation" flag (visibility is declared through `provides`) |
| **Hookable** | typed hooks, serial and parallel dispatch, unregister functions, tiny size | its untyped string default; hooks that live forever (here they are owned and counted) |
| **Unplugin** | one abstract plugin, many adapters; build-time use | its build-plugin API as the framework's plugin API; it is used as a host (graph validation at build time) |
| **Hono** | minimal runtime-neutral core, Web `Request` and `Response`, composition | its router (a catch-all over a live registry replaces it, so routes can come and go) |

## Other frameworks

| | How AIMBRACE differs |
|---|---|
| **NestJS** | no decorators, no runtime reflection metadata, no module ceremony. A plugin is a plain object; the dependency graph comes from `requires` and `provides`. |
| **Express** | no global mutable application object. Two apps in one process share nothing, and an app is single-use. |
| **Redux** | no central state store. State lives in services, scopes and registries that are owned by a lifetime. |
| **LangChain** | the core abstraction is not `Chain -> Chain`. It is context, services, plugins, scopes and hooks; an agent is one plugin among others. |
| **EventEmitter** | no `EventEmitter<string, any>` bus. Hooks are a typed map the compiler checks. |
| **tRPC** | the inference ambition (types flow from `definePlugin` and `service` calls, no codegen) without the RPC layer. |

## When not to use it

- You need a batteries-included web framework with an ecosystem of middleware: use Hono or Fastify directly (and AIMBRACE can sit under them).
- You have a handful of modules and no lifecycle problems: a composition runtime is overhead you do not need.
- You need a stable API today: Cordis 4 is a release candidate and AIMBRACE is 0.1.0; see [Status](../status.md).

## When it fits

- Applications assembled from many independently versioned parts (agent systems, plugin-rich tools, products with optional capabilities).
- Systems where **shutdown and cancellation correctness** matters: every acquisition has a disposer, and a leak is detectable.
- Code that must run under more than one host (an HTTP service, a CLI and a build step sharing one set of plugins).
