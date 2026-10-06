<p align="center">
  <img src="docs/assets/aimbrace-logo.png" alt="AIMBRACE" width="120">
</p>

<h1 align="center">AIMBRACE</h1>

<p align="center"><strong>A TypeScript application composition runtime built on <a href="https://github.com/cordiverse/cordis">Cordis</a>.</strong><br>
Not another plugin framework: an app is a typed graph of plugins.</p>

<p align="center"><a href="https://aimbrace.github.io">Website</a> · <a href="docs/README.md">Documentation</a> · <a href="docs/getting-started/quickstart.md">Quickstart</a> · <a href="docs/status.md">Status</a></p>

---

Each plugin declares what it `requires`, `provides` and hooks into. AIMBRACE derives the dependency graph, installs plugins in
topological order inside encapsulated contexts, runs a deterministic lifecycle, gives every task its own **scope**, and tears everything
down in reverse, with a leak probe to prove it. Write a plugin once; run it under any host.

```ts
import { createApp, definePlugin, service } from '@aimbrace/core'

const Settings = service<{ name: string }>('settings')
const Greeter = service<{ greet(who: string): string }>('greeter')

const settings = definePlugin({
  id: 'settings',
  provides: [Settings],
  setup: (ctx) => void ctx.provide(Settings, { name: 'AIMBRACE' }),
})

const greeter = definePlugin({
  id: 'greeter',
  requires: [Settings],
  provides: [Greeter],
  setup(ctx) {
    const { name } = ctx.get(Settings) // only what you declared type-checks
    ctx.provide(Greeter, { greet: (who) => `Hello ${who}, from ${name}!` })
  },
})

const app = createApp({ plugins: [greeter, settings] }) // listing order does not matter
await app.start()
console.log(app.get(Greeter).greet('world'))
await app.stop()
console.log(app.probe().clean) // true: nothing leaked
```

## What you get

- **A typed dependency graph.** Missing services, cycles, duplicate providers and version mismatches fail *before* anything runs, with a typo hint. Export it as text, Mermaid, DOT or JSON.
- **Typed access.** `ctx.get` only accepts what the plugin declared: a compile error otherwise, and a runtime error for plain JavaScript.
- **Deterministic lifecycle.** Install and start in dependency order, stop and dispose in reverse, roll back on failure, reactivate dependents when a provider returns.
- **Scopes.** One short-lived context per agent task or HTTP request, with an `AbortSignal`, local services, and everything released when it ends.
- **Registries and typed hooks.** Many contributors, no coupling; extensible hook maps with automatic cleanup.
- **One plugin, many hosts.** HTTP on Hono or Fastify, a CLI, Effect programs, and a build-time graph for Vite, Rollup, esbuild and more.

## Packages

| Package | |
|---|---|
| [`@aimbrace/core`](packages/core) | services, plugins, registries, hooks, scopes, lifecycle, graph |
| [`@aimbrace/loader`](packages/loader) | config modules, JSON manifests, plugin discovery |
| [`@aimbrace/http`](packages/http) · [`hono`](packages/hono) · [`fastify`](packages/fastify) | host-neutral HTTP contract and two hosts |
| [`@aimbrace/effect`](packages/effect) | Effect 4 Layers as plugins, interruption with scopes |
| [`@aimbrace/unplugin`](packages/unplugin) | validate the graph at build time, import it as virtual modules |
| [`@aimbrace/cli`](packages/cli) | `aimbrace graph / check / run / init`, plus commands your plugins contribute |
| [`@aimbrace/testing`](packages/testing) | `withApp`: start, stop, fail on any leak |
| [`plugins/`](plugins) | model, memory, tools and agent: a reference AI system |
| [`examples/`](examples) | `agent-cli` and `http-agent` |

## Try it

```sh
git clone https://github.com/aimbrace/aimbrace.git && cd aimbrace
corepack enable && pnpm install
pnpm run check                      # lint, build, verify packages, typecheck, test, run the examples

cd examples/agent-cli
npx aimbrace graph --format mermaid
npx aimbrace ask "calc: 2 + 3 * 4" --trace
```

## Status

0.1.0, pre-release, **not on npm yet**. Cordis 4 is a release candidate and is pinned exactly. See [Status](docs/status.md) for what is implemented and what is deferred.

## How it is built

Specified with [GitHub Spec Kit](https://github.com/github/spec-kit): the constitution is in [`.specify/memory/constitution.md`](.specify/memory/constitution.md), and each milestone has a spec,
plan and task ledger in [`specs/`](specs), including the defects found along the way. The documentation is tested: snippets run, links resolve, and every export is in its reference page.
The original architecture brief is [docs/aimbrace_spec.md](docs/aimbrace_spec.md).

## License

MIT
