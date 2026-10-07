# 012: The Cordis framework from ACRYL, with a builder inside the agent

## Decision (owner, 2026-10-07)

1. Use the Cordis that ACRYL runs on as the AIMBRACE framework, instead of the public `cordis`
   release candidate.
2. Give the `agent` template a builder: the agent writes Cordis plugins into the project, mounts
   them into the running app, and reads back their real state.
3. Define the extraction seam as an interface list first, and lift only what the list names. Leave
   the desktop behind.
4. Keep removing libraries that duplicate a Cordis capability.

## Amendment (owner, 2026-10-07): Deno is the runtime

AIMBRACE moves from Node to Deno (latest stable, 2.9.7), Deno only, no dual support. Reasons, each
tested on Deno 2.7.14 and 2.9.7 before the decision:

- the agent template runs unchanged on `npm:@deepseek-ai/cordis` 4.0.4: routes, `POST /ask`, clean
  stop on SIGINT;
- its tests pass under Deno;
- it runs with network access limited to `127.0.0.1` and no other permission;
- a Cordis plugin written in TypeScript runs with no build step, serves with `Deno.serve`, shuts it
  down on dispose, and type-checks with `deno check`. Services are typed the Cordis way:
  `declare module '@deepseek-ai/cordis' {
  interface Context { name: Type } }`, then `ctx.name`.

What it brings: TypeScript without a build, one toolchain (`deno fmt`, `lint`, `check`, `test`) in
place of Biome, tsdown, TypeScript and Vitest, web-standard `Deno.serve`, and permissions, which
confine the builder's agent-written plugins. Later, `deno compile` and Deno Desktop (experimental,
not used yet).

Not verified: Deno Desktop, celld. Known risk: `cordis-plugin-hmr` uses Node internals; the builder
reloads with a fresh `import()` instead, and `deno run --watch` covers development.

## Findings (verified 2026-10-07)

- The Cordis family ACRYL uses is published on npm by DeepSeek, MIT licensed, and depends on nothing
  from DeepSeek Harness: `@deepseek-ai/cordis` 4.0.4, `@deepseek-ai/schemastery` 3.18.4,
  `@deepseek-ai/cosmokit` 1.8.5, `@deepseek-ai/cordis-plugin-loader` 1.0.5, `-include` 1.0.9, `-hmr`
  1.0.19, `-group` 1.0.4, `-timer` 1.1.6, `-logger-console` 1.0.4. Extraction therefore needs no
  copied source: generated projects depend on the npm packages, pinned exactly. Copying (with MIT
  notices) is the fallback if a package is withdrawn or must change.
- ACRYL declares 99 to 250 Harness packages per app, but its own runtime source imports about 14.
  The rest are agent features the Loader mounts. ACRYL depends on Harness the agent product, not on
  its plugin system.
- ACRYL declares none of Hookable, Effect, Unplugin, Hono or Fastify. In AIMBRACE they are gone;
  `hookable` remains only as an internal dependency of the build tool `tsdown`, which is not ours to
  remove.
- The builder pattern is proven in `_experiments/cordis-interactive-tutorial`: a portable project,
  an agent with file tools and `mount_plugin`, and the settled fiber state (active, pending on a
  service, or the real error) returned to the agent so it iterates on facts.

## The seam (interface list)

What the framework is. Only these are lifted; nothing else from ACRYL comes along.

| Interface                                                                                       | Source in ACRYL                            | In AIMBRACE                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| Cordis core: `Context`, plugins, `provide`/`get`, `inject`, fibers, `effect`, events, `isolate` | `@deepseek-ai/cordis`                      | npm dependency of every template (Phase 1)                                        |
| Config schemas                                                                                  | `@deepseek-ai/schemastery`                 | npm, when a template first validates config                                       |
| Loader and bundle contracts (`cordis.yml` rows to plugins), hot reload                          | `cordis-plugin-loader`, `-include`, `-hmr` | npm, when the builder must persist mounted plugins across restarts (Phase 3)      |
| Tool seam: a `tools` service plugins register into, called by the agent                         | `ctx.tools` / `defineTool` in Harness      | own small Cordis service in the agent template (Phase 2)                          |
| Instance selection: where an app keeps its files, chosen once                                   | `AppInstance` family, `instance/select.ts` | one `workspace` service: the project directory the builder may write in (Phase 2) |
| Session bridge: one agent turn driven from outside                                              | `session-bridge.ts`                        | `POST /ask` on the agent template (exists)                                        |

Not lifted: Electron and the desktop app, market install, profile repair, Harness agent features
(sessions, LLM providers, tools catalogue).

## Requirements

- **FR1** Templates and docs use `@deepseek-ai/cordis` 4.0.4, pinned exactly. A generated project
  imports nothing else at runtime; its `deno.json` maps only `@deepseek-ai/cordis` and, for tests,
  `@std/assert`.
- **FR1a** Deno only: templates, CLI, docs examples, tests and scripts are TypeScript run by Deno
  2.9.7 with no build. HTTP uses `Deno.serve`. Every task declares the narrowest permissions that
  work. The repository has no `package.json`, Node lockfile, Biome, tsdown, TypeScript or Vitest
  configuration.
- **FR2** The `agent` template is a builder. Its tools: `list_files`, `read_file`, `write_file` (all
  confined to the project's `src/plugins/`), and `mount_plugin`, which imports the file fresh,
  mounts it on the running app, waits, and returns
  `{ state: 'active' | 'pending' | 'failed', missing?, error? }`.
- **FR3** On start, the app mounts every `src/plugins/*.mjs` it finds, so plugins the builder wrote
  survive a restart.
- **FR4** The default model stays deterministic and offline, scripted to build and mount a plugin,
  so the builder is tested end to end without a network. A real model is a plugin that calls an
  OpenAI-compatible endpoint with `fetch`, configured by environment variables, enabled by the user;
  no vendor SDK. Builder tasks grant write access to `src/plugins/` only.
- **FR5** No dependency that duplicates a Cordis capability, in templates or in the repository.

## Acceptance

`deno task check` green. `scripts/verify_scaffolder.ts` additionally asks the scaffolded agent to
build a plugin that adds a route, then requests that route on the running app, restarts the app, and
requests it again.

## Out of scope (recorded for ACRYL, not done here)

ACRYL clean-up the owner identified and this spec verified: merge `cli-market-*` and `web-market-*`
(plugins and install) behind one service each; one plugin lifecycle state instead of the copies in
`runtime/acryl-harness-runtime` and `apps/acryl-desktop`. These are ACRYL changes with their own
spec there.
