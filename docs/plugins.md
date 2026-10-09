# The plugin library

Each plugin is plain Cordis code in `plugins/<name>/` of this repository. `aimbrace init` and `aimbrace add` copy it into
your app's `src/plugins/<name>/` with the plugins it requires. Every one is tested in this repository with `node:test`
against a real Cordis context, including disposal.

| Plugin | Service | From ACRYL |
|---|---|---|
| [instance](#instance) | `appInstance` | `runtime/acryl-harness-runtime/src/instance/` |
| [http](#http-and-server), [server](#http-and-server) | `http`, `server` | - |
| [settings](#settings) | `settings` | `plugins/acryl-settings` |
| [extensions](#extensions) | `extensions` | `plugins/acryl-extension-context` |
| [builder](#builder) | tools for the agent | the agent's install tools |
| [agent](#agent) | `agent`, `model`, `tools`, `memory` | - |
| [tasks](#tasks) | `tasks` | idea from Pi Durable |
| [manifest](#manifest) | functions, no service | `runtime/blends-core` |
| [save](#save) | a tool for the agent | `runtime/app-persistence` |
| [digest](#digest) | a function | - |

## instance

Where the app keeps things, decided once. `selectInstance({ projectRoot, env })` is the only code that reads the
environment; it returns a frozen `AppInstance` with `root` (the project folder), `home` (`<project>/.aimbrace`, or
`AIMBRACE_HOME`), and a port preference: a stable port per app in 3100-3999 that moves to the next free one, or
`AIMBRACE_PORT`. Two folders with the same name are different apps. Mount it first: `root.plugin(instance, chosen)`.

## http and server

`http` is a router service: `ctx.http.route(method, path, handler)` returns the function that removes the route, so a
plugin adds routes inside `ctx.effect` and they leave with it. `server` serves the router with `node:http`, takes `{ port,
hostname, scan }` as its Cordis config, provides `ctx.server.url`, and closes on dispose.

## settings

`ctx.settings.register(namespace, schema, { base, applies, validate })` returns a scope with `get`, `watch`, `update`
and `replace`. The value layers the schemastery schema's defaults, then `base`, then what is stored in
`<home>/settings.yaml`. Writes are validated, atomic and run one at a time; watchers and the `settings/updated` event see
them in order; an unchanged value notifies nobody; pending writes settle on dispose.

## extensions

Install, update, remove and reload Cordis plugins while the app runs: `ctx.extensions.install(folder)`, `remove(name)`,
`reload()`, `list()`, `pending()`, `ledger()`. A failed update brings the previous version back. Config: `{ sources: [{
dir, trust: 'install' | 'list' }] }`. Details in [Extending a running app](extending-apps.md).

## builder

Gives the agent tools over Extensions: `list_plugins`, `read_plugin`, `write_plugin`, `install_plugin`, `remove_plugin`.
Writes are confined to one extensions folder (`{ dir }`, which must be an extensions source) and to source files. It
teaches the scripted model commands (`create route <name> <path> <text>`, `update route ...`, `break plugin <name>`,
`remove plugin <name>`, `list plugins`) so the whole loop runs offline.

## agent

`model` (a scripted, offline model; other plugins `teach` it rules), `tools` (a registry; a tool registered inside
`ctx.effect` leaves with its plugin), `memory`, and `agent`: `ctx.agent.run(question)` runs a loop in its own child fiber
with a step budget (`{ steps }`), and returns the answer with a trace of every tool call. A failing tool is reported to
the model, not thrown. Replace `model` with a real provider: it only has to implement `complete({ question, step,
toolResult })`.

## tasks

Durable task records: `ctx.tasks.start(kind, input, { parent })` returns a handle with `complete`, `fail`, `progress` and
an abort `signal`. Every change is appended to `<home>/tasks.jsonl` before the call returns. `cancel(id)` cancels the
tasks it owns too. After a crash, a task that was running is marked `interrupted` and is never run again on its own,
because a side effect may already have happened. When `tasks` is mounted, every agent run is a task owning one task per
tool call.

## manifest

`loadManifest(file, { known, values })`, `validate(document, known)`, `compose(root, manifest, registry, overrides)`,
`lock(manifest, sources)`, and `npm run lock`. See [The app manifest](manifest.md).

## save

`saveApp` over two ports (git and the hosting service), the secret scan, `npm run save`, and a `save_app` tool when the app
has a tool registry. It never reads, stores or asks for a token: git and gh use your own credential helpers.

## digest

`digestFolder(dir)`: the one definition of a folder's content digest, shared by extension staging and the lock.
