<p align="center">
  <img src="docs/assets/aimbrace-logo.png" alt="AIMBRACE" width="120">
</p>

<h1 align="center">AIMBRACE</h1>

<p align="center"><strong>Scaffold apps built on <a href="https://github.com/cordiverse/cordis">Cordis</a>.</strong><br>
Cordis is the framework. AIMBRACE gives you a working start.</p>

<p align="center"><a href="docs/README.md">Documentation</a> · <a href="docs/getting-started.md">Getting started</a> · <a href="docs/cordis.md">Building with Cordis</a></p>

---

Cordis already has what an app framework needs: plugins, services, `inject` dependencies, lifecycle, effects that clean
up after themselves, events, and isolation. AIMBRACE adds no runtime on top. `aimbrace init` copies a small Cordis
project that depends on `cordis` only, and every line of it is yours.

```sh
pnpm install && pnpm run build
node packages/cli/bin/aimbrace.js init ../my-app --agent -y
cd ../my-app && pnpm install && pnpm dev
```

Every part of the generated app is a Cordis plugin:

| Plugin | Role |
|---|---|
| `http` | provides the router service |
| `routes` | adds routes inside `ctx.effect`, removed when the plugin is disposed |
| `server` | serves the router over `node:http`, closes on stop |
| `model`, `tools`, `memory`, `agent` | the offline agent (`--agent`): one child fiber per run holds its step budget |

## Repository

| Path | What |
|---|---|
| `packages/cli` | the `aimbrace` command (`init`, `help`, `version`) and its two templates, `app` and `agent` |
| `scripts/verify-scaffolder.mjs` | scaffolds both templates, installs, runs their tests, boots them, requests their routes |
| `docs/` | the documentation; its Cordis examples are executed by the test suite |
| `specs/` | specs and ledgers ([roadmap](specs/000-roadmap/spec.md)) |

`pnpm run check` runs lint, build, typecheck, the tests and the scaffolder verification.

## License

MIT
