# __APP_NAME__

A Cordis app scaffolded by `aimbrace init`. It depends on `@deepseek-ai/cordis` only. Everything is a Cordis plugin: see `src/plugins/`.

```sh
pnpm install
pnpm dev          # http://127.0.0.1:3000 (set PORT to change it)
pnpm test

curl -X POST http://127.0.0.1:3000/ask -H 'content-type: application/json' -d '{"question":"add 2 3"}'
# {"status":"completed","output":"The answer is 5.","steps":2}
```

- `src/app.mjs` puts the plugins on one Cordis context.
- `src/plugins/http.mjs` provides the `http` router service.
- `src/plugins/routes.mjs` adds routes with `ctx.effect`, so they are removed when the plugin is disposed.
- `src/plugins/model.mjs`, `tools.mjs`, `memory.mjs` and `agent.mjs` are the offline agent: a deterministic model, a tool table, in-process memory, and one child fiber per run that holds its budget.
- `src/plugins/server.mjs` serves the router over `node:http` and closes the server on stop.
