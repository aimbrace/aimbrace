# __APP_NAME__

A Cordis app scaffolded by `aimbrace init`. It depends on `cordis` only. Everything is a Cordis plugin: see `src/plugins/`.

```sh
pnpm install
pnpm dev          # http://127.0.0.1:3000 (set PORT to change it)
pnpm test
```

- `src/app.mjs` puts the plugins on one Cordis context.
- `src/plugins/http.mjs` provides the `http` router service.
- `src/plugins/routes.mjs` adds routes with `ctx.effect`, so they are removed when the plugin is disposed.
- `src/plugins/server.mjs` serves the router over `node:http` and closes the server on stop.
