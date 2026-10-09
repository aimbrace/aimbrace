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
- `src/plugins/agent` is the offline agent: a scripted model, a tool registry, memory, and one child fiber per run.
- `src/plugins/extensions` installs, updates and removes plugins while the app runs; a failed update keeps the previous
  version running. `src/plugins/builder` gives the agent tools to do that itself, writing into `extensions/`.

Ask the agent to build something (the scripted model knows these commands; a real model reads the tool descriptions):

```sh
curl -X POST <url>/ask -H 'content-type: application/json' -d '{"question":"create route hello /hello Hello"}'
curl <url>/hello              # {"text":"Hello"}
curl <url>/extensions         # what is installed, and its state
```

Other commands: `update route <name> <path> <text>`, `break plugin <name>` (shows the rollback), `remove plugin <name>`,
`list plugins`. What the agent writes lands in `extensions/`, is part of your app, and starts again at the next start.
- `src/routes.ts` is your own plugin: routes added inside `ctx.effect`.
- `src/plugins/` holds the plugins copied from the AIMBRACE library. They are yours now; edit them freely.
  Add more with `aimbrace add <plugin>`.

Set `AIMBRACE_HOME` to keep data elsewhere, and `AIMBRACE_PORT` to choose the first port tried.
