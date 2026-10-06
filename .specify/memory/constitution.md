# AIMBRACE Constitution

This constitution governs every spec, plan, task and package in this repository.
If another document conflicts with it, this file wins until it is deliberately
amended (with a version bump below).

AIMBRACE is a **TypeScript application composition runtime**, not another plugin
framework. It is built on Cordis (Context, services, fibers, isolation, effects)
and borrows specific mechanisms from five other projects: Effect (typed
dependency algebra), Fastify (plugin graph and encapsulation), Hookable (typed
hooks), Unplugin (one plugin contract, many hosts) and Hono (minimal,
runtime-neutral core).

## Core Principles

### I. Everything is a plugin; the core knows nothing

`@aimbrace/core` has zero knowledge of any model vendor, database, HTTP server,
CLI, UI toolkit or agent concept. It contains only: Context, Service tokens,
Plugin, Registry, Hooks, Scope, Lifecycle and the dependency graph. Anything
else is a plugin or an adapter. A test enforces that core imports nothing but
`cordis`, `hookable` and the platform.

### II. Build on Cordis, never beside it

Context, fibers, service injection, isolation and effect disposal come from
Cordis. AIMBRACE adds a typed, declarative layer on top. It must not introduce a
second lifecycle engine, a second dependency-injection container, or a second
event bus. Where Cordis semantics are sufficient, AIMBRACE exposes them; where it
is insufficient, the gap is written down in `specs/*/research.md` before code.

### III. Dependencies are declared, typed, and a graph

A plugin states what it `requires`, `optional`ly uses and `provides`. Inside
`setup(ctx)` the context type only allows `get` of declared requirements and
`provide` of declared services: an undeclared access is a compile error. The
framework derives a dependency graph from the declarations, validates it
(missing, duplicate, cyclic, version-mismatched) before anything runs, installs in
topological order and tears down in the reverse order.

### IV. Every acquisition has a disposer (temporal composability)

Contexts have a lifetime. A Scope (global, app, plugin, task, call) owns every
resource acquired inside it - services, hooks, registry entries, timers,
listeners, abort signals - and releases all of them, in reverse order, when it
ends. A leak (a resource that outlives its Scope) is a bug, and tests assert
quiescence after dispose.

### V. Hooks are typed maps, not string events

Cross-cutting communication uses a typed `HookMap` over Hookable. There are no
`EventEmitter<string, any>` buses. Hook names are namespaced (`plugin:install`,
`agent:step`, `tool:before`) and every hook is declared in a map visible to the
type checker.

### VI. One plugin contract, many hosts

A plugin written once must run unchanged under every host adapter (CLI, HTTP via
Hono, HTTP via Fastify, build tool via Unplugin, Effect programs). Host specifics
live in adapters. Plugins talk to hosts only through Registries and Services
declared by a neutral contract package.

### VII. Small, runtime-neutral, dependency-poor

The core uses Web-standard primitives (`AbortSignal`, `AbortController`,
`Promise`, `EventTarget`, `structuredClone`) and no Node-only API. The core's
runtime dependencies are limited to `cordis` and `hookable`. Adding a runtime
dependency to a core package needs a written justification in the plan.

### VIII. Inference over ceremony

No decorators, no runtime reflection metadata, no code generation for types, no
global mutable singleton. Types flow from `definePlugin` and `service` calls.
Public API is small and every export has a TSDoc comment.

### IX. Test the lifecycle, not just the functions

Every package ships tests that exercise real activation, pending/reactivation,
isolation, disposal order and leak checks, using the real Cordis runtime (no
mocks of Cordis). Behaviour that is documented must have a test that would fail
if the behaviour changed.

### X. Honest specs and docs

When delivered behaviour diverges from `spec.md`, `plan.md` or `tasks.md`, the
ledger is updated in the same change. Docs state what is implemented, what is
experimental, and what is not done. Cordis 4 is a release candidate: its version
is pinned exactly and upgrades are deliberate.

## Engineering rules

- Language: TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), ESM only.
- Tooling: pnpm workspaces, tsdown builds, vitest tests, Biome lint and format.
- Commits: small, coherent, conventional (`feat(core): ...`). Never add an AI
  agent as co-author. Every milestone ends on a green `pnpm run check`.
- Never use the em dash character in code, comments, docs or commit messages.
- Do not hand-edit generated files or changelogs.
- Work happens on `main` with a pushed checkpoint at the end of each coherent step.

## Governance

Amendments need a changed version line, a one-paragraph rationale in
`specs/000-roadmap/research.md`, and updates to any plan that they invalidate.

**Version**: 1.0.0 | **Ratified**: 2026-10-06 | **Last Amended**: 2026-10-06
