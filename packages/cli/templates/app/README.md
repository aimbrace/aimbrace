# __APP_NAME__

A Cordis app on Node, scaffolded by `aimbrace init`. TypeScript, run by Node with no build step. Every part is a
Cordis plugin.

```sh
npm install
npm run dev        # prints its URL; data lives in .aimbrace/
npm test
npm run check      # type-check
```

- `src/main.ts` chooses where the app lives (`src/plugins/instance`) and starts it.
- `aimbrace.yaml` is the app as data: which plugins it mounts, in what order, with what config and parameters. Switch
  one off with `disabled: true`. `npm run lock` writes `aimbrace.lock.json`: the manifest's digest and a digest of
  every plugin folder, so a diff of the lock shows what changed.
- `src/app.ts` holds the registry of plugins the code provides, and mounts the manifest's rows.
- `src/routes.ts` is your own plugin: routes added inside `ctx.effect`.
- `src/plugins/` holds the plugins copied from the AIMBRACE library. They are yours now; edit them freely.
  Add more with `aimbrace add <plugin>`.

Set `AIMBRACE_HOME` to keep data elsewhere, and `AIMBRACE_PORT` to choose the first port tried.
