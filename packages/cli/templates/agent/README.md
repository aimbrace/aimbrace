# __APP_NAME__

A Cordis app on Node, scaffolded by `aimbrace init`. TypeScript, run by Node with no build step. Every part is a
Cordis plugin.

```sh
npm install
npm run dev        # prints its URL; data lives in .aimbrace/
npm test
npm run check      # type-check

curl -X POST <url>/ask -H 'content-type: application/json' -d '{"question":"add 2 3"}'
# {"status":"completed","output":"The answer is 5.","steps":2}
```

- `src/main.ts` chooses where the app lives (`src/plugins/instance`) and starts it.
- `src/app.ts` puts the plugins on one Cordis context.
- `src/plugins/agent` is the offline agent: a deterministic model, tools, memory, and one child fiber per run.
- `src/routes.ts` is your own plugin: routes added inside `ctx.effect`.
- `src/plugins/` holds the plugins copied from the AIMBRACE library. They are yours now; edit them freely.
  Add more with `aimbrace add <plugin>`.

Set `AIMBRACE_HOME` to keep data elsewhere, and `AIMBRACE_PORT` to choose the first port tried.
