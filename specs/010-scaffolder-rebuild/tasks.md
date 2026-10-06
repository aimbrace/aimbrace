# Tasks: M10 scaffolder rebuild ledger

Spec: [`./spec.md`](./spec.md). Plan: [`./plan.md`](./plan.md).
A task closes only when its exit evidence exists on `main`.

## T100 - Constitution amendment

- [ ] Rewrite the product definition in `.specify/memory/constitution.md`
  (scaffolder, not composition runtime; templates on raw Cordis; no wrapper
  runtime) with a version bump.
- Exit: diff of the constitution plus this task checked.

## T101 - `create-aimbrace` CLI skeleton

- [ ] `scaffolder/packages/create`: name/host/extras prompts plus matching
  flags, refuse-if-target-dirty, file copy, next-steps output.
- Exit: `create-aimbrace --help` works; setups covered by T106.

## T102 - Hono templates (base + agent)

- [ ] `scaffolder/templates/hono` and `hono-agent`: Cordis app plus route;
  agent variant adds mock model, memory, tools, one task scope. Offline
  deterministic, no vendor SDK.
- Exit: both install, boot, and serve 200 (via T106).

## T103 - Fastify templates (base + agent)

- [ ] Same as T102 on Fastify, same route body.
- Exit: both install, boot, and serve the identical 200 (via T106).

## T104 - Verify script

- [ ] `scaffolder/scripts/verify-scaffolder.mjs`: scaffolds all 4 templates in
  temp dirs, installs, boots, curls the route, runs template tests, scans for
  `@aimbrace/*` deps (any hit fails the build), enforces template count cap.
- Exit: script passes end to end on this machine.

## T105 - Template tests

- [ ] Per-template vitest suites: route test for all four, offline agent test
  for the two agent variants, refuse-overwrite test for the CLI.
- Exit: suites green inside T106 runs.

## T106 - Workspace check wiring

- [ ] Scaffolder `check` (lint, build, template tests, verify script) wired so
  the repo gate covers it; frozen packages untouched.
- Exit: gate green.

## T107 - Quickstart page

- [ ] `scaffolder/docs/quickstart.md`: zero to serving app on one page.
  A stranger (or fresh container) completes it in under 10 minutes.
- Exit: completed run plus time note in the ledger.

## T108 - npm publish

- [ ] `npm login` (owner) plus org, then `pnpm publish` of `create-aimbrace`;
  `npm view` resolves; fresh `npx create-aimbrace` works in an empty dir.
- Exit: version number recorded here. Blocked until the owner logs in.

## Cutover (explicitly NOT this milestone)

Old `packages/`, `plugins/`, `examples/` get deleted and the site shrinks only
after two real apps ship from the scaffolder. That decision gets its own spec.
