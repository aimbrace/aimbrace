# Config and loader

`@aimbrace/loader` turns files into apps. The brief's separate "config" package is folded in: plugin config is validated by
Standard Schemas in core, so only file handling is new.

## A config module

```js
// aimbrace.config.mjs
import { defineConfig } from '@aimbrace/loader'

export default defineConfig({
  name: 'my-app',
  plugins: [
    '@aimbrace/plugin-memory',                                         // a package: its default export
    './plugins/hello.mjs',                                             // a file, relative to this config
    { use: '@aimbrace/plugin-agent', config: { maxSteps: 6 } },        // with config
    somePlugin({ port: 8080 }),                                        // a plugin or configured instance, directly
  ],
})
```

`defineConfig` is an identity function for type checking. The config may also be a function (sync or async) that returns the object.

## A JSON manifest

```json
{
  "name": "my-app",
  "plugins": [
    "./plugins/hello.mjs",
    { "use": "@scope/pkg", "config": { "port": 8080 } }
  ]
}
```

The manifest is validated strictly: only `name` and `plugins`; each entry a string or `{ use, config? }`. Unknown keys are rejected
by name.

## Resolving a specifier

1. A relative or absolute path resolves from the config file's directory; a bare name resolves as an installed package from there
   (including ESM-only packages with no `require` condition).
2. The module is imported and the plugin is found: its `default` export, else a `plugin` export, else its only export that is a
   plugin.
3. A function export that is not a plugin is a **factory**: it is called with the entry's `config` and must return a plugin.
4. A plugin with `config` given becomes a configured instance. A module that already exports a configured instance rejects extra
   `config` (an error that says so).

Every failure is a `LoaderError` with `code`, `file` and `specifier` and a message that says what to fix.

## Finding and loading

| Function | Does |
|---|---|
| `findConfig(cwd?)` | Searches `aimbrace.config.ts`, `.mjs`, `.js`, `.cjs`, then `aimbrace.json`, in the directory and its parents. |
| `loadConfig(file)` | Loads a manifest or module and resolves every entry to a plugin. |
| `normaliseConfig(config, baseDir, file?)` | Resolves the entries of an in-memory config. |
| `createAppFromConfig(loaded, overrides?)` | Builds an `App` (does not start it). |
| `loadApp(fileOrDirectory?, overrides?)` | Find, load and build in one call. |
| `discoverPlugins(cwd?)` | Lists installed packages with an `aimbrace.plugin` entry. |

A TypeScript config file needs Node 24 (native type stripping) or a runtime that runs TypeScript. The loader says so when the
import fails.

## Plugin discovery

A package announces its plugin in `package.json`:

```json
{ "name": "@acme/aimbrace-search", "aimbrace": { "plugin": "./dist/index.js" } }
```

`discoverPlugins` looks at the dependencies of the nearest `package.json` and at `@aimbrace/plugin-*` packages in `node_modules`;
`aimbrace plugins` prints the result.
