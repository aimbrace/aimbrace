# Status

AIMBRACE is **0.1.0, pre-release**. It was built milestone by milestone with [Spec Kit](https://github.com/github/spec-kit); each milestone's spec, plan and task ledger is in
[`specs/`](https://github.com/aimbrace/aimbrace/tree/main/specs), including the defects found along the way and the test that now guards each one.

## Implemented

| Area | Package | State |
|---|---|---|
| Core: services, plugins, registries, hooks, scopes, lifecycle, graph | `@aimbrace/core` | implemented and heavily tested |
| Config and loader | `@aimbrace/loader` | implemented |
| HTTP contract | `@aimbrace/http` | implemented |
| Hono host | `@aimbrace/hono` | implemented, passes the shared contract suite |
| Fastify host | `@aimbrace/fastify` | implemented, passes the shared contract suite |
| Effect interop | `@aimbrace/effect` | implemented (Layer, runtime, interruption) |
| Build-time graph | `@aimbrace/unplugin` | implemented; Rollup, Rolldown and esbuild tested |
| CLI | `@aimbrace/cli` | implemented |
| Test helpers | `@aimbrace/testing` | implemented |
| Reference plugins | `@aimbrace/plugin-model`, `-memory`, `-tools`, `-agent` | implemented (mock model only) |
| Examples | `examples/agent-cli`, `examples/http-agent` | implemented, tested against built packages |
| Documentation | `docs/` | this set; snippets, links and exports are tested |
| Website | [aimbrace.github.io](https://aimbrace.github.io) | explainer and rendered docs |

`pnpm run check` runs lint, build, package export verification, typecheck, the unit tests and the example integration tests. CI runs it on Node 22 and 24 on Linux.

## Known limits and deferred work

Honest list. Items marked (design) are deliberate and documented in [Decisions](architecture/decisions.md).

- **Not published to npm.** No release automation yet, no changelog tooling.
- **Cordis 4 is a release candidate**; the version is pinned exactly and imports are confined to one file (design).
- **Explicit provider override** (two providers, one wins) is not implemented: a duplicate provider is an error (design, deferred).
- **Nested and dynamic plugins** are not part of the static graph; they are validated at install time (design).
- **Effect identifiers** are per value type, so two tokens with the same value type are not distinguished by the Effect type checker (design).
- **Platforms**: tested on Node 22 and 24 on Linux, developed on macOS. The core is written against Web primitives, but Bun and Deno are not exercised. Windows is not tested.
- **Unplugin**: Vite, webpack, Rspack, Farm and Bun adapters come from the same Unplugin definition but are not exercised in CI.
- **HTTP**: no typed route parameters; request body limits differ (Hono: none, Fastify: 10 MiB); no TLS or HTTP/2 configuration, CORS, compression or static files. Hosts are thin on purpose.
- **Model**: only a deterministic mock provider; no vendor adapters. The provider contract is the seam for them.
- **CLI**: no shell completions; `run` does not watch files or hot reload (Cordis's loader and HMR are not integrated).
- **Docs**: the reference pages are hand written and checked for completeness of runtime exports, not generated from types.

## How to follow along

- The task ledgers: [`specs/000-roadmap/tasks.md`](https://github.com/aimbrace/aimbrace/blob/main/specs/000-roadmap/tasks.md)
- The constitution (the ten principles every change is held to): [`.specify/memory/constitution.md`](https://github.com/aimbrace/aimbrace/blob/main/.specify/memory/constitution.md)
- Issues and discussion: [github.com/aimbrace/aimbrace](https://github.com/aimbrace/aimbrace)
