# Installation

## Status

AIMBRACE is at version 0.1.0 and is developed in the open at
[github.com/aimbrace/aimbrace](https://github.com/aimbrace/aimbrace). **The packages are not published to npm yet.**
Until the first release, work from a checkout (below). The package names and APIs in these docs are the real ones.

## Requirements

- Node.js 22.12 or newer (developed on 24). The core uses Web-standard primitives only (`AbortSignal`,
  `Promise`, `crypto.randomUUID` is used by the HTTP package) and has no Node-only import.
- ESM only. Packages are `"type": "module"`.
- TypeScript: the repository builds and type-checks with 6.0 and these compiler options, which the types are written for:
  `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. Other versions are untested.
- pnpm 12 (the repository pins `pnpm@12.4.2` through `packageManager`).

## From a checkout

```sh
git clone https://github.com/aimbrace/aimbrace.git
cd aimbrace
corepack enable
pnpm install
pnpm run check      # lint, build, verify packages, typecheck, test, run the examples
```

Then try an example:

```sh
cd examples/agent-cli
npx aimbrace graph --format mermaid
npx aimbrace ask "calc: 2 + 3 * 4" --trace
```

## Packages

| Package | What it is | Peer dependencies |
|---|---|---|
| `@aimbrace/core` | Services, plugins, registries, hooks, scopes, lifecycle, dependency graph | none (depends on `cordis`, `hookable`) |
| `@aimbrace/loader` | Config files, JSON manifests, plugin discovery | none |
| `@aimbrace/http` | Host-neutral HTTP contract: routes, middleware, dispatcher | none |
| `@aimbrace/hono` | Hono host | `hono` |
| `@aimbrace/fastify` | Fastify host | `fastify` |
| `@aimbrace/effect` | Effect 4 interop | `effect` |
| `@aimbrace/unplugin` | Build-time graph validation and virtual modules | none (depends on `unplugin`) |
| `@aimbrace/cli` | The `aimbrace` command | none |
| `@aimbrace/testing` | Test helpers | none |
| `@aimbrace/plugin-model`, `-memory`, `-tools`, `-agent` | Reference AI plugins | none |

## A first project

```sh
npx aimbrace init my-app          # pick a host (hono or fastify) and optionally the agent
cd my-app
pnpm install
pnpm dev
```

`init` copies a Cordis template into an empty directory. It never overwrites files.
See [Scaffold a Cordis app](scaffold.md).

## Pinned dependencies

Cordis 4 is a release candidate, so AIMBRACE pins `cordis@4.0.0-rc.10` exactly and confines every import of it
to one file (`packages/core/src/internal/cordis.ts`). A Cordis upgrade is a deliberate change guarded by a
compatibility test suite. See [Decisions](../architecture/decisions.md).
