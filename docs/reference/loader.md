# @aimbrace/loader

Config modules, JSON manifests and plugin discovery. Depends on `@aimbrace/core`. Guide: [Config and loader](../guides/config-and-loader.md).

| Export | |
|---|---|
| `defineConfig(config)` | identity function that type-checks `{ name?, plugins, onError? }` |
| `loadConfig(file)` | load an `aimbrace.json` manifest or an `aimbrace.config.*` module; returns a `LoadedConfig` with every plugin resolved |
| `findConfig(cwd?)` | search `CONFIG_NAMES` in the directory and its parents |
| `CONFIG_NAMES` | `aimbrace.config.ts`, `.mjs`, `.js`, `.cjs`, `aimbrace.json`, in priority order |
| `normaliseConfig(config, baseDir, file?)` | resolve the entries of an in-memory config |
| `createAppFromConfig(loaded, overrides?)` | build an `App` (not started) |
| `loadApp(fileOrDirectory?, overrides?)` | find, load and build |
| `resolvePlugin(entry, baseDir, file)` | resolve one specifier or `{ use, config }` to a plugin |
| `validateManifest(raw, file)` | strict shape check of a parsed manifest |
| `isPluginEntry(value)` | guard for `{ use, config? }` |
| `discoverPlugins(cwd?)` | list installed packages with an `aimbrace.plugin` entry |
| `LoaderError` | `code` `E_LOADER`, `file`, `specifier` |

Types: `AimbraceConfig`, `AimbraceManifest`, `ConfigEntry`, `PluginEntry`, `LoadedConfig`, `DiscoveredPlugin`.
