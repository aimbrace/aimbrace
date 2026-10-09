# Extending a running app

An AIMBRACE app with the `agent` template can be extended while it runs, by you or by its agent. This is ACRYL's
self-extension, extracted: in ACRYL's packaged app an agent-written plugin installs, runs, updates and is removed live
on macOS, Windows and Linux.

## An extension

An extension is a folder in an extensions source (the app's `extensions/` by default) whose name is the plugin's name, with
an `index.ts` that exports a Cordis plugin:

<!-- extension: hello -->
```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'
export const inject = ['greeting']

export function apply(ctx: Context) {
  ctx.provide('hello', `${String(ctx.get('greeting'))}, world`)
}

/** Optional: run after the plugin starts. It must pass for the install to count. */
export function check(ctx: Context) {
  if (ctx.get('hello') !== 'hi, world') throw new Error('hello is not ready')
}
```

Rules, checked before anything changes:

- the folder is inside one of the extensions sources, and its name is lowercase letters, digits and dashes;
- `index.ts` (or `.js`) exports `apply`, and `name` (when exported) equals the folder name;
- imports are relative files and packages the app already has; new npm packages need `npm install` in the app first.

The docs test installs the example above through the real `extensions` plugin, so this contract cannot drift.

## What install does

1. **Check** the folder (no code runs).
2. **Stage** a copy named by its content digest, and **import** it fresh, while the old version keeps running. An error
   here changes nothing.
3. **Start** it as a child fiber of the `extensions` plugin; the old version is disposed first.
4. **Verify**: if the plugin exports `check(ctx)`, it must pass within 10 s.
5. **Record** the result in the ledger, then answer.

If step 3 or 4 fails, the old version is started again and the answer says `restoredPrevious: true`. The answer is
always structured:

```json
{ "ok": true, "name": "hello", "action": "installed", "state": "active", "missing": [], "version": "c0ffee12ab34" }
{ "ok": false, "stage": "verify", "errors": ["its check failed: hello is not ready"], "restoredPrevious": true, "next": "..." }
```

`state` is the plugin's real Cordis state: `active`, `pending` (with `missing`: the services it waits for) or `failed`.

## Trust

At startup, Extensions installs again what was installed, and installs new folders only from sources marked
`trust: 'install'`; folders in a source marked `trust: 'list'` are only reported (`pending()`), because code that arrived
through a `git pull` should not run until someone asks. The app's own `extensions/` is trusted: it is the app's code,
committed with it, type-checked with `npm run check`.

## The builder

The `builder` plugin gives the agent `write_plugin`, `install_plugin`, `read_plugin`, `list_plugins` and `remove_plugin`.
`write_plugin` only writes source files (`.ts`, `.js`, `.mjs`, `.json`, `.md`) inside one plugin folder. A real model
reads the tool descriptions; the offline scripted model knows these commands:

| Command | Does |
|---|---|
| `create route <name> <path> <text>` | writes a plugin that answers `GET <path>` with `{ text }` and checks its own route, then installs it |
| `update route <name> <path> <text>` | the same over the existing plugin |
| `break plugin <name>` | writes a version that throws, to show the rollback |
| `remove plugin <name>` | removes it and deletes its folder |
| `list plugins` | lists installed extensions and their state |

## What to look at

- `GET /extensions`: what is installed, its state, and folders not installed yet.
- `<home>/extensions-ledger.jsonl`: every install, update, refusal, restore and removal, with the version's digest.
- `GET /tasks`: every agent run as a durable task, owning one task per tool call; `POST /tasks/cancel { id }`.

Node keeps every module version it has loaded, so memory grows a little with each update until the app restarts.
