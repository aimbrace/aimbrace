# The app manifest

`aimbrace.yaml` is the app as data: which plugins it mounts, in what order, with what config. It is ACRYL Blends'
manifest, extracted: rows, typed parameters, diagnostics and a lock. The code an app can use stays in `src/app.ts` as a
registry of imports (so it type-checks); the manifest chooses, orders, configures and switches those plugins.

```yaml
apiVersion: aimbrace/v1
kind: App
metadata:
  name: my-app
  version: 0.1.0
  visibility: private          # anything but public is private; save refuses a public remote
parameters:
  hostname: { type: string, default: 127.0.0.1 }
plugins:
  - id: http
  - id: routes
  - id: server
    config:
      hostname: "{{parameters.hostname}}"
  - id: old-feature
    use: routes
    disabled: true             # switched off without touching code
```

- **Rows** mount in order. `id` names the slot; `use` is the registry entry (defaults to the id); `config` is the plugin's
  Cordis config; `disabled: true` skips the row.
- **Parameters** are typed (`string`, `number`, `boolean`). A config value that is exactly `{{parameters.x}}` keeps the
  parameter's type; inside a longer string it is text. `createApp(chosen, { values: { hostname: '0.0.0.0' } })` sets one.
- **Runtime values win**: `app.ts` passes what is only known at run time (the port, the extensions folder) as overrides.

## Diagnostics

Every problem is reported at once, with a code and a path, before anything is mounted:

```text
aimbrace.yaml is not a valid app manifest:
  plugins[1].use: no plugin 'ghost' in the app's registry (known: http, routes, server) [unknown-plugin]
  plugins[0].config.x: refers to undeclared parameter 'missing' [dangling-parameter-reference]
```

Codes: `parse-error`, `schema-error`, `duplicate-row-id`, `unknown-plugin`, `dangling-parameter-reference`,
`unused-parameter`, `parameter-type-mismatch`, `parameter-override-unknown`.

## The lock

`npm run lock` writes `aimbrace.lock.json`: the manifest's sha256, its resolved rows and parameter values, and a content
digest of every folder in `src/plugins/`. Commit it. A diff of the lock is a review of what the app is built from.
