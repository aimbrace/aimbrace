# **APP_NAME**

A Cordis app on Deno, scaffolded by `aimbrace init`. It imports `@deepseek-ai/cordis` and nothing
else. Every part is a Cordis plugin: see `src/plugins/`.

```sh
deno task dev       # http://127.0.0.1:3000 (set PORT to change it)
deno task test
deno task check     # format, lint, type-check
```

- `src/app.ts` puts the plugins on one Cordis context.
- `src/plugins/http.ts` provides the typed `http` router service.
- `src/plugins/routes.ts` adds routes inside `ctx.effect`, so they are removed when the plugin is
  disposed.
- `src/plugins/server.ts` serves the router with `Deno.serve` and shuts down on stop. Its port and
  hostname are its Cordis plugin config.

The tasks in `deno.json` run with network access to `127.0.0.1` only, and read only the `PORT`
variable.
