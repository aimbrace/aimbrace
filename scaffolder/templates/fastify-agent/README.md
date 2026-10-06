# __APP_NAME__

A Cordis app scaffolded by `create-aimbrace`. Everything is a Cordis plugin: see `src/plugins/`.

```sh
pnpm install
pnpm dev          # http://127.0.0.1:3000 (set PORT to change it)
pnpm test
```

Layout:

- `src/app.mjs` composes the plugins with `inject` ordering.
- `src/plugins/http.mjs` provides the HTTP app (__HOST__).
- `src/plugins/routes.mjs` adds routes to it.
- `src/plugins/server.mjs` starts listening once the routes are ready, and closes on stop.
