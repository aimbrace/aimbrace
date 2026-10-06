# Research: decisions behind the AIMBRACE roadmap

## R1. Wrap Cordis; do not reimplement it

**Decision**: `@aimbrace/core` builds `App` on a real Cordis `Context`. Plugins become Cordis
plugins (`{ name, inject, apply }`), services use `ctx.provide(name)` and `ctx.set(name, value)`.

**Evidence** (spike against `cordis@4.0.0-rc.10`):

- A plugin whose `inject` names a missing service stays `PENDING` (state 0) and activates when the provider appears (state 2).
- Disposing the provider returns the consumer to `PENDING`, so reactivation is free.
- `ctx.isolate('database')` gives a child context its own `database` namespace; the root does not see it. This is the basis for Fastify-style encapsulation.
- Effects (`ctx.effect`) are collected on the fiber and disposed in reverse order, including async disposers.

**Gap found**: when a provider is disposed, Cordis disposes the provider's effects before the dependents finish unloading (observed order: `db:dispose`, then `agent:dispose`). AIMBRACE therefore drives shutdown itself: `stop` in reverse topological order, then dispose fibers one by one in reverse order, awaiting each. Cordis alone is not enough for the "reverse of startup" guarantee.

## R2. Static graph on top of dynamic injection

Cordis resolves dependencies dynamically (names, at runtime). The brief asks for a first-class
typed graph. Decision: two layers.

1. **Static**: `definePlugin` metadata yields a `Graph` before anything runs: validation, ordering, exporters.
2. **Dynamic**: Cordis `inject` guarantees safety at runtime (PENDING until satisfied, reactivation after provider replacement).

Nested plugins installed from inside `setup` via `ctx.use()` are not part of the static graph;
they appear in the observed tree (`app.inspect()`), built from the `plugin:install` hook.

## R3. Typed service tokens vs Cordis's global `Context` augmentation

Cordis types services by merging into the `Context` interface (global). AIMBRACE uses value
tokens (`service<T>(name)`) so types flow through function arguments and different apps never
collide in the type system. The token name is the Cordis service name underneath; tokens are
registered once per app and a duplicate name with a different token object is an error.

## R4. Where each reference library is used literally

| Library | Used as a dependency? | How |
|---|---|---|
| cordis | yes (core) | substrate |
| hookable | yes (core) | `Hooks<T>` wraps `Hookable` |
| unplugin | yes (`@aimbrace/unplugin`) | build-time graph validation plus virtual module `virtual:aimbrace/graph` for Vite/Rollup/esbuild/webpack/Rolldown |
| hono | yes (`@aimbrace/hono`) | HTTP host |
| fastify | yes (`@aimbrace/fastify`) | HTTP host with plugin encapsulation mapping |
| effect | yes (`@aimbrace/effect`) | Layer interop |

## R5. Version pins

`cordis@4.0.0-rc.10` is the latest tag on npm (`next` is `4.0.0-beta.5`). Pin exactly.
`hookable@6.1.2`, `unplugin@3.4.0`, `hono@4.13.x`, `fastify@5.12.x`, `effect@4.0.1`.
TypeScript 6.0.3 is used instead of 7.x because the declaration-bundling toolchain still targets the JS compiler API.

## R6. Repository naming

Package scope `@aimbrace`. The brief uses `@acryl/*` as placeholder names; they are replaced by `@aimbrace/*` here.
