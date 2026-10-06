# Your first app

This is the path from nothing to a running app made of plugins. It takes about fifteen minutes and needs only Node 22 or newer.

## 1. Scaffold

```sh
npx aimbrace init my-app       # from a checkout, see installation.md; the package is not on npm yet
cd my-app
npx aimbrace check             # validates the graph and every config; runs no plugin code
npx aimbrace run               # starts the app and waits for Ctrl+C
```

`init` writes three things: `aimbrace.config.mjs` (the list of plugins), `plugins/hello.mjs` (one plugin), and a `package.json`.

## 2. Add a plugin

A plugin is a plain object. This one needs a service the app already has and offers one of its own:

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, service } from '@aimbrace/core'

const Clock = service<{ now(): string }>('clock')
const Stamp = service<{ stamp(text: string): string }>('stamp')

const clock = definePlugin({
  id: 'clock',
  provides: [Clock],
  setup: (ctx) => void ctx.provide(Clock, { now: () => '2026-01-01T00:00:00Z' }),
})

const stamp = definePlugin({
  id: 'stamp',
  requires: [Clock],
  provides: [Stamp],
  setup(ctx) {
    const clock = ctx.get(Clock)
    ctx.provide(Stamp, { stamp: (text) => `[${clock.now()}] ${text}` })
  },
})

const app = createApp({ plugins: [stamp, clock] })
await app.start()
assert.equal(app.get(Stamp).stamp('hello'), '[2026-01-01T00:00:00Z] hello')
await app.stop()
assert.equal(app.probe().clean, true)
```

Put the same code in `plugins/stamp.mjs` and add it to `plugins` in `aimbrace.config.mjs`. Then `aimbrace graph` shows it, wired by what it requires and provides.

## 3. Serve it over HTTP

Routes are plugins too. They contribute to a registry, so the same routes run under Hono or Fastify:

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, definePlugin, service } from '@aimbrace/core'
import { get, http, HttpAddress, routesPlugin, text } from '@aimbrace/http'
import { honoHost } from '@aimbrace/hono'

const Greeter = service<{ greet(who: string): string }>('greeter')

const greeter = definePlugin({
  id: 'greeter',
  provides: [Greeter],
  setup: (ctx) => void ctx.provide(Greeter, { greet: (who) => `hello ${who}` }),
})

const app = createApp({
  plugins: [
    http,
    honoHost({ port: 0 }), // port 0 picks a free port; use 3000 in a real app
    routesPlugin('web', [get('/hi/:who', (ctx) => text(ctx.scope.get(Greeter).greet(ctx.params.who)))]),
    greeter,
  ],
})
await app.start()
const response = await fetch(`${app.get(HttpAddress).url}/hi/ada`)
assert.equal(await response.text(), 'hello ada')
await app.stop()
```

Swap `honoHost` for `fastifyHost` and nothing else changes.

## 4. Test it

```ts docs-test
import assert from 'node:assert/strict'
import { definePlugin, service } from '@aimbrace/core'
import { mockService, withApp } from '@aimbrace/testing'

const Clock = service<{ now(): string }>('clock')
const Stamp = service<{ stamp(text: string): string }>('stamp')

const stamp = definePlugin({
  id: 'stamp',
  requires: [Clock],
  provides: [Stamp],
  setup(ctx) {
    const clock = ctx.get(Clock)
    ctx.provide(Stamp, { stamp: (text) => `[${clock.now()}] ${text}` })
  },
})

// Replace the real clock with a fixed one, then check the plugin's behaviour.
await withApp({ plugins: [mockService(Clock, { now: () => 'fixed' }), stamp] }, (app) => {
  assert.equal(app.get(Stamp).stamp('hi'), '[fixed] hi')
})
```

`withApp` starts the app, runs the body, stops it, and fails the test if anything leaked. See [Test plugins](../guides/testing-plugins.md).

## Where next

- [Write a plugin](../guides/write-a-plugin.md): the rules that keep plugins well behaved.
- [Concepts](../concepts/overview.md): the model behind the graph, lifecycle and scopes.
- [AI agents](../guides/ai-agents.md): a complete system built from plugins.
