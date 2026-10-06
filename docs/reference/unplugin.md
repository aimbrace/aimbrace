# @aimbrace/unplugin

Build-time graph validation and virtual modules. Depends on `unplugin`, `@aimbrace/core`, `@aimbrace/loader`. Guide: [Build-time graph](../guides/build-time-graph.md).

## `unplugin`

The Unplugin instance: `unplugin.vite`, `.rollup`, `.rolldown`, `.esbuild`, `.webpack`, `.rspack`, `.farm`, `.bun`, `.raw`. Each bundler also has a default-export entry point:
`@aimbrace/unplugin/vite`, `/rollup`, `/rolldown`, `/esbuild`, `/webpack`, `/rspack`, `/farm`, `/bun`.

Options (`AimbraceUnpluginOptions`): `config`, `plugins`, `strict` (default true), `cwd`.

## Virtual modules

| Constant | Module id | Default export |
|---|---|---|
| `VIRTUAL_GRAPH` | `virtual:aimbrace/graph` | the graph as JSON: `{ ok, nodes, edges, order, diagnostics }` |
| `VIRTUAL_MERMAID` | `virtual:aimbrace/mermaid` | the Mermaid flowchart string |
| `VIRTUAL_PLUGINS` | `virtual:aimbrace/plugins` | the plugin metadata list; named export `order` |

Types for the modules: `@aimbrace/unplugin/virtual`.

## `loadGraph(options?)`

Load the plugins (from `plugins` or the config) and build the graph. Returns `{ graph, file }`. Used by the unplugin and usable on its own. Type: `LoadedGraph`.
