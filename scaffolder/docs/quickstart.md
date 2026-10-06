# Quickstart: a Cordis app in five minutes

You need Node 22.12 or newer and pnpm. Nothing else.

```sh
npx create-aimbrace my-app          # answer the prompts, or pass --host and --agent (see below)
cd my-app
pnpm install
pnpm dev                            # http://127.0.0.1:3000
```

In another terminal:

```sh
curl http://127.0.0.1:3000/         # {"app":"my-app","ok":true}
pnpm test
```

Stop the app with Ctrl+C. It closes the server and exits.

## Choose a host and an agent

| Flags | Result |
|---|---|
| (none, or `--yes`) | Hono app, no agent |
| `--host fastify` | Fastify app |
| `--agent` | adds an offline agent: `POST /ask` |
| `--host fastify --agent --yes` | everything non-interactive |

Try the agent:

```sh
curl -X POST http://127.0.0.1:3000/ask -H 'content-type: application/json' -d '{"question":"add 2 3"}'
# {"status":"completed","output":"The answer is 5.","steps":2}
```

The agent is deterministic and makes no network calls, so the tests run offline.

## What you got

Open `src/app.mjs`. It composes Cordis plugins; ordering comes from `inject`:

- `src/plugins/http.mjs` provides the HTTP app.
- `src/plugins/routes.mjs` adds routes to it.
- `src/plugins/server.mjs` starts listening once the routes are ready, and closes on stop.

With the agent template you also get `model.mjs`, `tools.mjs`, `memory.mjs` and `agent.mjs`. Each one is a plain Cordis plugin: a function or an object with `inject` and `apply`.

Your project depends only on `cordis` and the host library. There is no framework package to learn.

## Next steps

- Add a route: edit `src/plugins/routes.mjs`, or add a new plugin that injects `http.app`.
- Add a service: `ctx.provide('name', value)` in one plugin, `ctx.get('name')` or `inject: ['name']` in another.
- Replace the mock model: write a plugin that provides `model` with a real provider, and remove the mock.

Cordis documentation: <https://github.com/cordiverse/cordis>.

## Troubleshooting

- `refusing to write into ... not empty`: choose a new directory. The scaffolder never overwrites files.
- `pnpm install` fails: check your network and that Node is 22.12 or newer.
