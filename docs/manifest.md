# The app manifest

`blend.yaml` is the app as data: which plugins it mounts, in what order, with what config. It is written in ACRYL's own Blend
format (`blends.acryl.dev/v1alpha1`) and named the way ACRYL names an app definition, so an app can move into ACRYL without
conversion. The code an app can use stays in `src/app.ts` as a registry of imports (so it type-checks); the manifest chooses,
orders, configures and switches those plugins.

```yaml
apiVersion: blends.acryl.dev/v1alpha1
kind: Blueprint
metadata:
  id: aimbrace.my-app          # dotted id
  name: my-app
  version: 0.1.0
  visibility: private          # anything but public is private; save refuses a public remote
spec:
  runtime: cordis
  parameters:
    hostname: { type: string, default: 127.0.0.1 }
  rows:
    - id: http
      name: http               # id is the slot, name is the plugin it loads
    - id: routes
      name: routes
    - id: server
      name: server
      config:
        hostname: "{{parameters.hostname}}"
    - id: old-feature
      name: routes
      disabled: true           # switched off without touching code
```

- **Rows** mount in order. `id` names the slot; `name` is the registry entry it loads; `config` is the plugin's Cordis config;
  `disabled: true` skips the row.
- **Parameters** (`spec.parameters`) are typed (`string`, `number`, `boolean`). A config value that is exactly
  `{{parameters.x}}` keeps the parameter's type; inside a longer string it is text. `createApp(chosen, { values: { hostname:
  '0.0.0.0' } })` sets one.
- **Runtime values win**: `app.ts` passes what is only known at run time (the port, the extensions folder, the manifest's own
  digest) as overrides.

## Compatible with ACRYL, and what is not read yet

A test checks both templates' manifests against ACRYL's own JSON schema (copied from `runtime/blends-core`), so what this plugin
accepts is a valid `blend.yaml`. Two things differ on purpose:

- An aimbrace app is a **Blueprint**. A **Blend** (an instance that has a `lineage` to its Blueprint, with `extends` and
  `overrides`) is part of the format but is not read yet: the plugin reports it as `unsupported` and does not ignore it. How a Blend
  upgrades from its Blueprint is the part ACRYL Blends adds on top of this prototype.
- ACRYL's lock format differs from ours. `npm run lock` writes `aimbrace.lock.json` (below), not a Blend lock.

## Diagnostics

Every problem is reported at once, with a code and a path, before anything is mounted:

```text
blend.yaml is not a valid app manifest:
  spec.rows[1].name: no plugin 'ghost' in the app's registry (known: http, routes, server) [unknown-plugin]
  spec.rows[0].config.x: refers to undeclared parameter 'missing' [dangling-parameter-reference]
```

Codes: `parse-error`, `schema-error`, `unsupported`, `duplicate-row-id`, `unknown-plugin`, `dangling-parameter-reference`,
`unused-parameter`, `parameter-type-mismatch`, `parameter-override-unknown`.

## The lock

`npm run lock` writes `aimbrace.lock.json`: the manifest's sha256, its resolved rows and parameter values, and a content digest of
every folder in `src/plugins/`. Commit it. A diff of the lock is a review of what the app is built from.
