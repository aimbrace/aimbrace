# Building with Cordis

Cordis already is the framework. Everything below is plain Cordis on Deno, the same code the
templates use. Each example is a complete TypeScript module; the docs test runs every one of them.

## Plugins and services

A plugin is a function, or an object with `name`, `inject` and `apply`. A plugin offers a capability
by providing a service; another plugin asks for it by name in `inject`. Declare the service on
`Context` once, and `ctx.greeter` is typed everywhere.

```ts
import { assertEquals } from '@std/assert'
import { Context } from '@deepseek-ai/cordis'

interface Greeter {
  greet(who: string): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    greeter: Greeter
  }
}

const root = new Context()

function greeter(ctx: Context) {
  ctx.provide('greeter', { greet: (who: string) => `Hello, ${who}!` } satisfies Greeter)
}

let welcome = ''
const user = {
  name: 'user',
  inject: ['greeter'],
  apply(ctx: Context) {
    welcome = ctx.greeter.greet('Cordis')
  },
}

await root.plugin(greeter).await()
await root.plugin(user).await()
assertEquals(welcome, 'Hello, Cordis!')
```

## `inject` waits for the service

A plugin whose injected service does not exist yet stays pending. It starts the moment the service
appears, so the order you call `plugin` in does not matter.

```ts
import { assertEquals } from '@std/assert'
import { Context } from '@deepseek-ai/cordis'

const root = new Context()
const started: string[] = []

root.plugin({ name: 'consumer', inject: ['db'], apply: () => void started.push('consumer') })
assertEquals(started, [])

await root.plugin((ctx: Context) => ctx.provide('db', { query: () => [] })).await()
await new Promise((resolve) => setTimeout(resolve, 0))
assertEquals(started, ['consumer'])
```

Await fibers in dependency order: `fiber.await()` on a fiber that is still pending returns before it
has started. The templates' `src/app.ts` awaits each fiber after the plugins it injects.

## Effects clean up after the plugin

Anything a plugin acquires goes in `ctx.effect`: the function returns its own disposer, and Cordis
calls it when the plugin is disposed. A disposer returned from `apply` works the same way.

```ts
import { assertEquals } from '@std/assert'
import { Context } from '@deepseek-ai/cordis'

const root = new Context()
const routes = new Set<string>()

const fiber = root.plugin((ctx: Context) => {
  ctx.effect(() => {
    routes.add('GET /')
    return () => void routes.delete('GET /')
  })
})
await fiber.await()
assertEquals([...routes], ['GET /'])

await fiber.dispose()
assertEquals([...routes], [])
```

## Events

`ctx.on` subscribes and `ctx.emit` dispatches. A listener belongs to the plugin that added it and is
removed with it.

```ts
import { assertEquals } from '@std/assert'
import { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'order/placed'(id: string): void
  }
}

const root = new Context()
const seen: string[] = []

const fiber = root.plugin((ctx: Context) => {
  ctx.on('order/placed', (id) => void seen.push(id))
})
await fiber.await()
root.emit('order/placed', 'a1')

await fiber.dispose()
root.emit('order/placed', 'b2')
assertEquals(seen, ['a1'])
```

Cordis also has `parallel`, `serial`, `bail` and `waterfall` dispatch for listeners that return
values.

## A scope per task

A plugin can open a child plugin for one piece of work and dispose it when the work ends. Whatever
the child provides or registers is gone afterwards. The agent template runs every question this way,
with the step budget held in the child.

```ts
import { assertEquals } from '@std/assert'
import { Context } from '@deepseek-ai/cordis'

const root = new Context()
let steps = 0

const task = root.plugin({
  name: 'task-1',
  apply(scope: Context) {
    const budget = { steps: 0, limit: 3 }
    scope.provide('budget', budget)
    while (budget.steps < budget.limit) budget.steps += 1
    steps = budget.steps
  },
})
await task.await()
await task.dispose()
assertEquals(steps, 3)
```

## HTTP with `Deno.serve`

Cordis has no HTTP server, and needs none: Deno has one. The templates split HTTP into three
plugins. `http` provides a router service, `routes` adds routes inside `ctx.effect`, and `server`
serves the router with `Deno.serve` and shuts it down when it is disposed. Port and hostname are the
`server` plugin's Cordis config.

```ts
import { assertEquals } from '@std/assert'
import { Context } from '@deepseek-ai/cordis'

type Handler = () => unknown

declare module '@deepseek-ai/cordis' {
  interface Context {
    router: { route(path: string, handler: Handler): () => void; handle(path: string): unknown }
    address: { url: string }
  }
}

const root = new Context()

function router(ctx: Context) {
  const routes = new Map<string, Handler>()
  ctx.provide('router', {
    route(path: string, handler: Handler) {
      routes.set(path, handler)
      return () => void routes.delete(path)
    },
    handle: (path: string) => routes.get(path)?.(),
  })
}

const routes = {
  name: 'routes',
  inject: ['router'],
  apply(ctx: Context) {
    ctx.effect(() => ctx.router.route('/', () => ({ ok: true })))
  },
}

const server = {
  name: 'server',
  inject: ['router'],
  apply(ctx: Context, config: { port: number }) {
    const listener = Deno.serve(
      { port: config.port, hostname: '127.0.0.1', onListen() {} },
      (request) => {
        const body = ctx.router.handle(new URL(request.url).pathname)
        return body === undefined ? new Response(null, { status: 404 }) : Response.json(body)
      },
    )
    ctx.provide('address', { url: `http://127.0.0.1:${listener.addr.port}` })
    return () => listener.shutdown()
  },
}

const fibers = [root.plugin(router), root.plugin(routes), root.plugin(server, { port: 0 })]
for (const fiber of fibers) await fiber.await()

const response = await fetch(`${root.get('address')?.url}/`)
assertEquals(await response.json(), { ok: true })

for (const fiber of fibers.reverse()) await fiber.dispose()
```

## Permissions

Deno runs nothing with more access than you grant. The templates' tasks in `deno.json` allow network
access to `127.0.0.1` and reading the `PORT` variable, and nothing else. Widen a task only when a
plugin needs it, and say why.

## Testing

Test what a user sees: boot the app on port 0, request a route, stop it. The templates'
`test/app_test.ts` does exactly that with `Deno.test`, with no mocks of Cordis. Deno's test runner
also fails a test that leaves a server, timer or response body open.

## Further reading

- Cordis (the DeepSeek fork the templates use): <https://www.npmjs.com/package/@deepseek-ai/cordis>
- Deno: <https://docs.deno.com>
