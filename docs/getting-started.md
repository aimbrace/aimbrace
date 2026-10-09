# Getting started

You need Node 22.12 or newer and pnpm.

## Create an app

From a checkout of this repository:

```sh
pnpm install
pnpm run build
node packages/cli/bin/aimbrace.js init ../my-app     # answer the questions, or pass flags (below)
cd ../my-app
pnpm install
pnpm dev                                             # http://127.0.0.1:3000
```

In another terminal:

```sh
curl http://127.0.0.1:3000/          # {"app":"my-app","ok":true}
pnpm test
```

Stop the app with Ctrl+C. Every plugin is disposed and the server closes.

## The two templates

| Command | You get |
|---|---|
| `aimbrace init my-app --no-agent -y` | `app`: a router, two routes and a `node:http` server, as Cordis plugins |
| `aimbrace init my-app --agent -y` | `agent`: the same app plus an offline agent behind `POST /ask` |

Both depend on `@deepseek-ai/cordis` and nothing else. `init` never writes into a directory that is not empty.

Try the agent:

```sh
curl -X POST http://127.0.0.1:3000/ask -H 'content-type: application/json' -d '{"question":"add 2 3"}'
# {"status":"completed","output":"The answer is 5.","steps":2}
```

The agent's model is deterministic and makes no network calls, so its tests run offline. Replace the `model` plugin
with a real provider when you have one.

## Flags

| Flag | Meaning |
|---|---|
| `--agent` / `--no-agent` | include the offline agent (asked when not given) |
| `--name <name>` | project name (default: the directory name) |
| `--install` | run `pnpm install` after copying |
| `-y`, `--yes` | ask nothing; no agent and no install unless flagged |

## Next

Read [Building with Cordis](cordis.md), then open `src/app.mjs` in your new project.
