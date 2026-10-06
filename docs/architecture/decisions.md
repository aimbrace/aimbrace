# Decisions

The choices behind the design, each with the evidence that drove it. The full research notes live in
[`specs/000-roadmap/research.md`](https://github.com/aimbrace/aimbrace/blob/main/specs/000-roadmap/research.md) and the per-milestone `tasks.md` files, which also record
every defect found while building (and the test that now guards it).

## R1. Wrap Cordis, do not reimplement it

`App` is built on a real Cordis `Context`. A plugin is a Cordis fiber (`{ name, inject, apply }`), a service is `ctx.provide`, isolation is `ctx.isolate`,
disposal is Cordis effects. Evidence from a spike against `cordis@4.0.0-rc.10`:

- a plugin whose `inject` names a missing service stays `PENDING` and activates when the provider appears;
- disposing the provider returns the dependent to `PENDING`, so reactivation is free;
- `ctx.isolate(name)` gives a child its own namespace for a service;
- effects are collected per fiber and disposed in reverse order, including asynchronous ones.

**A gap found**: disposing a provider disposes its effects *before* its dependents have finished unloading (observed order: `db:dispose`, then `agent:dispose`),
and a fiber's separate effects are disposed in parallel. Cordis alone does not give "stop in the reverse of the start order". AIMBRACE drives shutdown itself:
`stop` in reverse order, then each plugin's own LIFO resource stack, then its fiber, one plugin at a time. A compatibility suite pins the Cordis behaviours relied on.

## R2. A static graph on top of dynamic injection

Cordis resolves dependencies dynamically, by name, at run time. The brief asked for a first-class typed graph. So there are two layers: a **static** graph from `definePlugin`
metadata (validation, ordering, exporters; runs before anything), and Cordis's **dynamic** injection as the runtime safety net (pending until satisfied, reactivation after
replacement). Plugins installed from inside `setup` or after start are validated when installed and appear in the observed tree.

## R3. Value tokens, not global type augmentation

Cordis types services by merging into the global `Context` interface. AIMBRACE uses value tokens (`service<T>(name)`) so types flow through function arguments, different apps
cannot collide in the type system, and a plugin's context can be narrowed to its declarations. The Cordis name is `aimbrace:<name>`, which cannot clash with built-ins.

## R4. Where each reference library is used literally

| Library | Dependency? | Where |
|---|---|---|
| cordis | yes, `@aimbrace/core` | substrate |
| hookable | yes, `@aimbrace/core` | `Hooks<T>` |
| unplugin | yes, `@aimbrace/unplugin` | build-time graph and virtual modules |
| hono | peer, `@aimbrace/hono` | HTTP host |
| fastify | peer, `@aimbrace/fastify` | HTTP host |
| effect | peer, `@aimbrace/effect` | Layer interop |

## R5. Pins

`cordis@4.0.0-rc.10` (exact: it is a release candidate; every import lives in one file), `hookable@6.1.2`, `unplugin@3.4.0`. Hono 4.13, Fastify 5.12 (the published line; Fastify `main`
is a 6.0 alpha), Effect 4.0.1. TypeScript 6.0.3: the declaration bundler still targets the JavaScript compiler API.

## R6. Names

The scope is `@aimbrace`. The brief's `@acryl/*` names were placeholders.

## R7. Scope-local values are a plain chain, not Cordis services

Cordis scopes a service by isolating it *before* the fiber that provides or consumes it exists. A task scope needs the opposite: open now, provide a task-local value
later, concurrently, in many siblings. Providing one service name from sibling fibers in one namespace is a Cordis error, and lazy isolation would make child scopes
created earlier blind to later values. So `scope.provide/get/maybe` use a small `Map` chain (scope, parent scopes, then app services). It is context-local state
(comparable to `AsyncLocalStorage`), not a second dependency-injection container: it has no resolution and no graph, and is not injectable into plugins. Plugins installed
into a scope still use real Cordis injection, and `install(..., { isolate })` uses real Cordis isolation.

## R8. Cordis service removal is asynchronous

The function returned by `ctx.provide` removes the service, waits for dependents to unload, then touches the owning fiber's store. A caller that drops that promise and disposes the
fiber at once makes Cordis throw an unhandled `TypeError`. It was found because vitest reports unhandled rejections. AIMBRACE awaits every service removal before a fiber is disposed.

## D9. Per-activation resources

A plugin may be activated more than once (a provider returns). Each activation has its own context, its own LIFO stack, abort signal, hook scope and registry views, so a reload
cannot leak into or inherit from the previous activation. Per-activation state in plugins must therefore live inside `setup`.

## D10. Hosts serve a registry through one catch-all

Hono cannot add routes after its first request, and AIMBRACE routes come and go with plugins. Both HTTP hosts register one catch-all and call a shared dispatcher over the live
`Routes` registry. Routing is therefore identical across hosts by construction, and one contract suite proves the rest over real sockets.

## D11. A scope per unit of work, bound to the response body

The HTTP dispatcher opens `request:<id>` and disposes it only when the response body is fully read or cancelled, so streaming responses keep their scope and a client disconnect
cancels everything under it (it propagates through the stream even without an explicit abort).

## D12. Hook observers see everything

`beforeEach`/`afterEach` observers see every hook call, including hooks nobody registered, are counted by the leak probe and are removed by `clear()`. A first version skipped
unregistered fire-and-forget hooks as an optimisation, which hid service, scope and registry events from tracing.

## D13. The leak probe is part of the contract

`app.probe()` counts plugins, scopes, services, hooks, registry entries and subscribers, and tracked Cordis fibers. Every lifecycle test ends by asserting it is clean, and
`@aimbrace/testing` makes that a one-liner for plugin authors.

## D14. Examples are integration tests of the built packages

Bare specifiers in an example config resolve to each package's `dist`, as in a real project. Examples run through a separate vitest configuration after the build. A guard script
(`scripts/verify-packages.mjs`) checks every `main`, `types` and `exports` target exists after the build and that each package imports from `dist`; it exists because five packages once
shipped `.mjs` files while `package.json` pointed at `.js` and every test (which runs from source) passed.

## D15. Docs are tested

Snippets marked `ts docs-test` run in the test suite, every link and anchor is checked, every runtime export must be in its reference page, and every error code in the sources must be in
the catalogue.

## Considered and deferred

- **Explicit provider override** (two providers, one wins): a duplicate provider is an error for now.
- **Static graph for nested plugins**: nested and dynamic installs are validated at install time.
- **Typed route parameters**: `ctx.params` is `Record<string, string>`.
- **Hot reload**: Cordis's loader and HMR packages are not integrated.
