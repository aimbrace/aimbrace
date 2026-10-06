# Build-time graph

`@aimbrace/unplugin` validates your plugin graph **when the build starts** and serves it to your app as virtual modules.
It is one [Unplugin](https://unplugin.unjs.io/) definition, so it works with Vite, Rollup, Rolldown, esbuild, webpack, Rspack,
Farm and Bun.

## Install it

```ts
// vite.config.ts
import aimbrace from '@aimbrace/unplugin/vite'

export default { plugins: [aimbrace()] }
```

```js
// rollup.config.js
import aimbrace from '@aimbrace/unplugin/rollup'
export default { input: 'src/main.js', plugins: [aimbrace()] }

// esbuild
import aimbrace from '@aimbrace/unplugin/esbuild'
await build({ entryPoints: ['src/main.ts'], bundle: true, plugins: [aimbrace()] })
```

Entry points: `/vite`, `/rollup`, `/rolldown`, `/esbuild`, `/webpack`, `/rspack`, `/farm`, `/bun`. Tests exercise Rollup,
Rolldown and esbuild; the others come from the same Unplugin definition but are not exercised in CI.

## Options

| Option | Default | |
|---|---|---|
| `config` | found by walking up from `cwd` | an `aimbrace.config.*` module or `aimbrace.json` |
| `plugins` | | plugins given directly instead of a config file |
| `strict` | `true` | `true`: an invalid graph fails the build. `false`: it warns and the graph is still served |
| `cwd` | `process.cwd()` | where to look for the config |

## What a failing build looks like

```text
Invalid AIMBRACE plugin graph:
  - Plugin "agent" requires service "model", but no plugin provides it. Did you mean "models"?
```

Missing services, cycles, duplicate providers and peer problems fail the build before any bundling work.

## Virtual modules

```ts
import graph from 'virtual:aimbrace/graph'      // { ok, nodes, edges, order, diagnostics }
import mermaid from 'virtual:aimbrace/mermaid'  // a Mermaid flowchart string
import plugins, { order } from 'virtual:aimbrace/plugins' // plugin metadata list, and the install order
```

Add the types with `/// <reference types="@aimbrace/unplugin/virtual" />` (or `"types": ["@aimbrace/unplugin/virtual"]`). This is how
the project website renders its architecture diagrams from a real graph.

## Notes on portability

- Strict mode throws from `buildStart`, which every bundler reports as a build failure.
- `addWatchFile` is only allowed inside `resolveId`, `load` and `transform` under esbuild, so the config file is registered
  for watching from `resolveId`.
- The non-strict warning is emitted when a virtual module is resolved (esbuild forwards warnings only from a `resolveId` that
  returns a result), with a `console.warn` fallback at the end of a build that never imports one.
- The config is loaded with a dynamic `import()`. A TypeScript config file needs Node 24 (native type stripping) or a
  runtime that runs TypeScript.
