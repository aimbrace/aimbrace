# Hosts

> One plugin contract; multiple hosts.

A **host** turns the outside world into calls on your plugins: a network, a terminal, a build tool, an Effect
program. The Unplugin lesson applied to apps: write a plugin once, run it under any host. A plugin reaches a host
only through a **registry** and a **service** declared by a neutral package, never through the host's own API.

| Host | Neutral contract | Adapters |
|---|---|---|
| HTTP | `Routes`, `Middlewares` registries and `HttpDispatcher` in `@aimbrace/http` (Web `Request` and `Response`) | `@aimbrace/hono`, `@aimbrace/fastify` |
| CLI | `Commands` registry in `@aimbrace/cli` | the `aimbrace` command |
| Effect | `layerPlugin`, `createEffectRuntime` | `@aimbrace/effect` |
| Build time | the plugin graph | `@aimbrace/unplugin` (Vite, Rollup, Rolldown, esbuild, webpack, Rspack, Farm, Bun) |

A plugin that contributes a route imports `@aimbrace/http`, not Hono. Swapping `honoHost()` for `fastifyHost()` changes one
line, and a shared contract suite proves the behaviour is identical (one contract suite over real sockets, run unchanged against both).

## Writing a host

A host is an ordinary plugin. The recipe:

1. Define a registry (and/or a service) for what plugins contribute.
2. In your plugin, read the registry **at call time**, so contributors can come and go.
3. Open a [scope](scopes.md) per unit of work; give it a signal; dispose it when the work ends.
4. Acquire sockets, timers and servers inside `start` (or `setup`) and release them in `stop` and with `ctx.own`.
5. Keep per-activation state inside `setup`, not in module scope.

This complete host runs jobs contributed by other plugins, each in its own scope:

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, registry, service } from '@aimbrace/core'

// The neutral contract: what plugins contribute, and what the host offers.
interface Job {
  name: string
  run(signal: AbortSignal): Promise<string>
}
const Jobs = registry<Job>('jobs', { key: (job) => job.name })
const Runner = service<{ runAll(): Promise<Record<string, string>> }>('job-runner')

// The host: a plugin that serves the registry.
const jobHost = definePlugin({
  id: 'job-host',
  provides: [Runner],
  setup(ctx) {
    const jobs = ctx.registry(Jobs)
    ctx.provide(Runner, {
      async runAll() {
        const results: Record<string, string> = {}
        for (const job of jobs.all()) {
          // one scope per unit of work, ended when the work is
          await (await ctx.scope(`job:${job.name}`)).run(async (scope) => {
            results[job.name] = await job.run(scope.signal)
          })
        }
        return results
      },
    })
  },
})

// Plugins that know nothing about the host's internals.
const hello = definePlugin({
  id: 'hello-job',
  setup: (ctx) => void ctx.registry(Jobs).add({ name: 'hello', run: async () => 'hi' }),
})
const clean = definePlugin({
  id: 'clean-job',
  setup: (ctx) => void ctx.registry(Jobs).add({ name: 'clean', run: async () => 'tidy' }),
})

const app = createApp({ plugins: [jobHost, hello, clean] })
await app.start()
assert.deepEqual(await app.get(Runner).runAll(), { hello: 'hi', clean: 'tidy' })
assert.equal(app.probe().scopes, 0)
await app.stop()
```

## Choosing the neutral type

Use Web-standard types at the seam (`Request`, `Response`, `AbortSignal`) so the same plugin can run in Node, Bun and
Deno. The core and `@aimbrace/http`'s routing and dispatch use no Node-only API.

See [HTTP hosts](../guides/http-hosts.md), [the CLI](../guides/cli.md), [Effect interop](../guides/effect-interop.md) and
[the build-time graph](../guides/build-time-graph.md) for each host in detail.
