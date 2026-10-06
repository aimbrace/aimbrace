# @aimbrace/http

The host-neutral HTTP contract. Depends on `@aimbrace/core` and `valibot` (host config). Guide: [HTTP hosts](../guides/http-hosts.md).

## Plugin

### `http`

The core plugin. Provides `HttpDispatcher` over the live `Routes` and `Middlewares` registries. Host plugins require it.

## Tokens

| Export | |
|---|---|
| `Routes` | `registry<Route>`, keyed `METHOD path` |
| `Middlewares` | `registry<MiddlewareEntry>` |
| `HttpDispatcher` | service: `dispatch(request)`, `match(method, pathname)`, `routes()` |
| `HttpAddress` | service: `url`, `hostname`, `port`; filled in once the host is listening |

## Routes and responses

| Export | |
|---|---|
| `route(method, path, handler, options?)` | create a `Route`; `method` is one method, an array, or `'*'` |
| `get`, `post`, `put`, `patch`, `del` | shorthands |
| `routesPlugin(id, routes, { middleware? })` | a plugin that only contributes routes and middleware |
| `json(data, init?)`, `text(body, init?)`, `html(body, init?)` | build a `Response` |
| `redirect(location, status?)` | status 301, 302 (default), 303, 307 or 308 |
| `HttpError(status, message?, { headers?, cause? })` | throw from a handler to set the response |

## Dispatch internals

| Export | |
|---|---|
| `createDispatcher({ ctx, routes, middleware, report })` | the dispatcher behind the `http` plugin; opens a `request:<id>` scope per request |
| `compileRoute(route, order)`, `matchRoutes(compiled, method, pathname)` | the router: static beats param beats wildcard; 404, 405 with `Allow`, HEAD falls back to GET |

## Host building blocks

| Export | |
|---|---|
| `HostConfig` | the Standard Schema every host uses: `port` (3000), `hostname` (`127.0.0.1`), `listen` (true), `shutdownGraceMs` (1000); accepts no config at all |
| `createAddressHolder()` | the holder behind `HttpAddress`: `view`, `set(hostname, port)`, `clear()` |

## Types

`Route`, `RouteContext` (`id`, `request`, `url`, `params`, `scope`, `signal`, `route`), `Handler`, `Middleware`, `MiddlewareEntry` (`handler`, `order`, `name`), `HttpMethod`,
`MatchResult`, `CompiledRoute`, `DispatcherContext`, `HttpRequestInfo`, `HttpResponseInfo`, `HostOptions`, `HostInput`, `AddressHolder`.

## Hooks (declared by merging into `HookExtensions`)

`http:request` (id, method, path), `http:response` (adds status, durationMs), `http:error` (the thrown value).
