# Getting started

You need Deno 2.9 or newer. Nothing else: no Node, no package manager.

## Create an app

From a checkout of this repository:

```sh
deno task aimbrace init ../my-app      # answer the questions, or pass flags (below)
cd ../my-app
deno task dev                          # http://127.0.0.1:3000
```

Or install the command once and use it anywhere:

```sh
deno task install-cli
aimbrace init my-app
```

In another terminal:

```sh
curl http://127.0.0.1:3000/            # {"app":"my-app","ok":true}
deno task test
deno task check                        # format, lint, type-check
```

Stop the app with Ctrl+C. Every plugin is disposed and the server shuts down.

## The two templates

| Command                              | You get                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `aimbrace init my-app --no-agent -y` | `app`: a router, two routes and a `Deno.serve` server, as Cordis plugins |
| `aimbrace init my-app --agent -y`    | `agent`: the same app plus an offline agent behind `POST /ask`           |

Both are TypeScript, run without a build, and import `@deepseek-ai/cordis` and nothing else at
runtime. Their tasks run with network access to `127.0.0.1` only. `init` never writes into a
directory that is not empty.

Try the agent:

```sh
curl -X POST http://127.0.0.1:3000/ask -H 'content-type: application/json' -d '{"question":"add 2 3"}'
# {"status":"completed","output":"The answer is 5.","steps":2}
```

The agent's model is deterministic and makes no network calls, so its tests run offline. Replace the
`model` plugin with a real provider when you have one.

## Flags

| Flag                     | Meaning                                             |
| ------------------------ | --------------------------------------------------- |
| `--agent` / `--no-agent` | include the offline agent (asked when not given)    |
| `--name <name>`          | project name (default: the directory name)          |
| `--install`              | run `deno install` after copying                    |
| `-y`, `--yes`            | ask nothing; no agent and no install unless flagged |

## Next

Read [Building with Cordis](cordis.md), then open `src/app.ts` in your new project.
