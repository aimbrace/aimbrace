# HTTP hosts

`@aimbrace/http` defines HTTP once, in Web-standard terms. `@aimbrace/hono` and `@aimbrace/fastify` serve it. Your route
plugins import only the neutral package.

```ts docs-test
import assert from 'node:assert/strict'
import { createApp } from '@aimbrace/core'
import { get, http, HttpAddress, HttpDispatcher, HttpError, json, post, routesPlugin, text } from '@aimbrace/http'
import { honoHost } from '@aimbrace/hono'

// Routes only: no Hono, no Fastify.
const api = routesPlugin('api', [
  get('/hello/:name', (ctx) => text(`hello ${ctx.params.name}`)),
  post('/echo', async (ctx) => json({ you: await ctx.request.json() })),
  get('/teapot', () => {
    throw new HttpError(418, 'I am a teapot')
  }),
])

// Only this line names a host. Swap in fastifyHost({ port: 0 }) and nothing else changes.
const app = createApp({ plugins: [http, honoHost({ port: 0 }), api] })
await app.start()

const base = app.get(HttpAddress).url as string
assert.equal(await (await fetch(`${base}/hello/ada`)).text(), 'hello ada')
assert.deepEqual(await (await fetch(`${base}/echo`, { method: 'POST', body: '{"a":1}' })).json(), { you: { a: 1 } })
const teapot = await fetch(`${base}/teapot`)
assert.equal(teapot.status, 418)
assert.deepEqual(await teapot.json(), { error: 'I am a teapot' })
assert.equal((await fetch(`${base}/nowhere`)).status, 404)

// The dispatcher is plain Request -> Response, so it can be tested with no socket at all.
const response = await app.get(HttpDispatcher).dispatch(new Request('http://test/hello/bob'))
assert.equal(await response.text(), 'hello bob')

await app.stop()
assert.equal(app.probe().clean, true)
```

## How it works

```text
route plugins --add--> Routes registry  <--read live--  HttpDispatcher  <--dispatch(Request)--  host (Hono or Fastify)
middleware plugins --> Middlewares registry                                     one catch-all route
```

The `http` plugin provides `HttpDispatcher` over the **live** registries. Each host registers a single catch-all and calls
`dispatch`, so routes and middleware can be added or removed while the server runs (Hono cannot add routes after its first
request; a catch-all over a registry sidesteps that).

## Routes

`get`, `post`, `put`, `patch`, `del` and `route(method, path, handler)` create routes. `method` may be one method, an array, or `'*'`.

| Pattern | Matches |
|---|---|
| `/health` | exactly that path |
| `/users/:id` | one segment, captured as `params.id` (percent-decoded) |
| `/files/*` | the rest of the path, captured as `params['*']` |

Specificity decides: static beats param beats wildcard, then registration order. A trailing slash is ignored.

| Situation | Response |
|---|---|
| no route matches the path | `404 {"error":"Not Found"}` |
| the path matches but not the method | `405` with an `Allow` header |
| `HEAD` without a `HEAD` route | falls back to `GET`, body removed |
| handler throws `HttpError(status, message, { headers })` | that status, `{"error": message}` |
| handler throws anything else | `500 {"error":"Internal Server Error"}`; the message is never sent; `http:error` fires |
| handler does not return a `Response` | `500` |

`html`, `json`, `text` and `redirect` build responses.

## The request context

A handler receives `{ id, request, url, params, scope, signal, route }`.

- `request` is a standard `Request` (read the body with `.json()`, `.text()`, `.arrayBuffer()`, or stream it).
- `scope` is a [scope](../concepts/scopes.md) that lives exactly as long as the request, **the response body included**: a
  streaming response keeps its scope until the stream ends or is cancelled. Provide request-local services there; register
  hooks through it and they vanish with the request.
- `signal` aborts when the client disconnects or the app begins stopping. Pass it to anything cancellable.
- Read app services with `ctx.scope.get(Token)`.

## Middleware

`Middlewares` entries are `{ handler(ctx, next), order?, name? }`. Lower `order` runs first; ties keep registration order.
`next()` may be called at most once. Return a response without calling `next()` to short-circuit.

## Hooks

`http:request` (method, path, id), `http:response` (adds status and duration) and `http:error` (the thrown value).

## Hosts

| | `@aimbrace/hono` | `@aimbrace/fastify` |
|---|---|---|
| plugin | `honoHost(config?)` | `fastifyHost(config?)` |
| native instance | service `HonoApp` | service `FastifyApp` |
| peer dependency | `hono ^4.13` | `fastify ^5` |

Both take the same config and provide the `HttpAddress` service (`url`, `hostname`, `port`, filled in after the host starts):

| Option | Default | |
|---|---|---|
| `port` | `3000` | `0` picks a free port |
| `hostname` | `127.0.0.1` | |
| `listen` | `true` | `false` builds the host without a socket |
| `shutdownGraceMs` | `1000` | how long in-flight connections may finish on stop before they are cut |

`HonoApp` and `FastifyApp` are escape hatches for host-specific plugins. Using them makes a plugin host-specific; the neutral
contract does not need them.

## Streaming and Server-Sent Events

A handler may return a `Response` with a `ReadableStream` body. `examples/http-agent` pushes an agent's steps as they happen over
`text/event-stream`, using a hook registered **through the request scope** (removed when the response ends) and passing the
request id and signal to the agent, so a client that disconnects cancels the run and both scopes are released.

## Writing a third host

Implement a plugin that `requires: [HttpDispatcher]`, provides `HttpAddress` (use `createAddressHolder()`), builds a catch-all
that converts the native request to a Web `Request`, calls `dispatch`, and writes the `Response` back, and listens in `start`
and closes in `stop`. The shared contract suite (`packages/http/test/contract.ts`, `runHttpContract(label, makeHost)`)
is the acceptance test: it exercises routing, bodies, errors, middleware, scopes, streaming, cancellation and shutdown over real sockets.
