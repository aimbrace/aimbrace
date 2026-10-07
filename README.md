<p align="center">
  <img src="docs/assets/aimbrace-logo.png" alt="AIMBRACE" width="120">
</p>

<h1 align="center">AIMBRACE</h1>

<p align="center"><strong>Scaffold apps built on Cordis, running on Deno.</strong><br>
Cordis is the framework. AIMBRACE gives you a working start.</p>

<p align="center"><a href="docs/README.md">Documentation</a> · <a href="docs/getting-started.md">Getting started</a> · <a href="docs/cordis.md">Building with Cordis</a></p>

---

Cordis already has what an app framework needs: plugins, services, `inject` dependencies, lifecycle,
effects that clean up after themselves, events, and isolation. AIMBRACE adds no runtime on top.
`aimbrace init` copies a small Cordis project in TypeScript that imports `@deepseek-ai/cordis` only
(the Cordis that ACRYL runs on), and every line of it is yours. Deno runs it without a build step,
tests and checks it with its own tools, and runs it with network access to `127.0.0.1` only.

```sh
deno task aimbrace init ../my-app --agent -y
cd ../my-app && deno task dev
```

Every part of the generated app is a Cordis plugin:

| Plugin                              | Role                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `http`                              | provides the typed router service                                            |
| `routes`                            | adds routes inside `ctx.effect`, removed when the plugin is disposed         |
| `server`                            | serves the router with `Deno.serve`, shuts down on stop                      |
| `model`, `tools`, `memory`, `agent` | the offline agent (`--agent`): one child fiber per run holds its step budget |

## Repository

| Path                           | What                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `packages/cli`                 | the `aimbrace` command (`init`, `help`, `version`) and its two templates, `app` and `agent` |
| `scripts/verify_scaffolder.ts` | scaffolds both templates, checks and tests them, boots them, requests their routes          |
| `docs/`                        | the documentation; its Cordis examples are executed by the tests                            |
| `specs/`                       | specs and ledgers ([roadmap](specs/000-roadmap/spec.md))                                    |

`deno task check` runs format, lint, type-check, the tests and the scaffolder verification. Requires
Deno 2.9 or newer.

## License

MIT
