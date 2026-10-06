# @aimbrace/hono

The Hono host. Peer dependency: `hono ^4.13`. Depends on `@aimbrace/http` and `@hono/node-server`. Guide: [HTTP hosts](../guides/http-hosts.md).

## `honoHost(config?)`

A plugin that `requires` `HttpDispatcher` and provides `HonoApp` and `HttpAddress`. It registers one catch-all (`app.all('*')`) that calls `dispatch`, listens in `start`,
and closes the server in `stop` (idle connections first, the rest after `shutdownGraceMs`). Config is `HostConfig`: `port`, `hostname`, `listen`, `shutdownGraceMs`.
Used with no config it listens on `127.0.0.1:3000`.

```ts
createApp({ plugins: [http, honoHost({ port: 8080 }), myRoutes] })
```

## `HonoApp`

A service holding the native `Hono` instance, for host-specific plugins. Using it makes a plugin Hono-only; the neutral contract does not need it.
