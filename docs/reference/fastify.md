# @aimbrace/fastify

The Fastify host. Peer dependency: `fastify ^5`. Depends on `@aimbrace/http`. Guide: [HTTP hosts](../guides/http-hosts.md).

## `fastifyHost(config?)`

A plugin that `requires` `HttpDispatcher` and provides `FastifyApp` and `HttpAddress`. It parses every content type as a raw buffer (so the neutral `Request` body is untouched),
registers one catch-all (`app.all('/*')`) that calls `dispatch`, listens in `start` and closes in `stop`. Config is `HostConfig`. The body limit is 10 MiB.

## `FastifyApp`

A service holding the native Fastify instance (for example to use `inject` in tests, or to add Fastify plugins). Using it makes a plugin Fastify-only.

## Conversion helpers

| Export | |
|---|---|
| `toWebRequest(req, signal)` | build a Web `Request` from a Fastify request with a buffer body |
| `sendWebResponse(reply, response)` | write a Web `Response` through a Fastify reply: streams the body, keeps repeated `Set-Cookie` |

They are exported so a custom Fastify integration can reuse them.
