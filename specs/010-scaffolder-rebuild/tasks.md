# Tasks: M10 scaffolder rebuild ledger

Spec: [`./spec.md`](./spec.md). Plan: [`./plan.md`](./plan.md).
A task closes only when its exit evidence exists on `main`.

## T100 - Constitution amendment

- [x] Rewrite the product definition in `.specify/memory/constitution.md`
  (scaffolder, not composition runtime; templates on raw Cordis; no wrapper
  runtime) with a version bump.
- Evidence: constitution amendment 2.0.0, research R9.
- Exit: diff of the constitution plus this task checked.

## T101 - `create-aimbrace` CLI skeleton

- [x] `scaffolder/packages/create`: name/host/extras questionnaire plus matching
  flags, refuse-if-target-dirty, file copy, next-steps output.
- Evidence: create-aimbrace CLI, 12 tests.
- Exit: `create-aimbrace --help` works; setups covered by T106.

## T102 - Hono templates (base + agent)

- [x] `scaffolder/templates/hono` and `hono-agent`: Cordis app plus route;
  agent variant adds mock model, memory, tools, one task scope. Offline
  deterministic, no vendor SDK.
- Evidence: hono and hono-agent templates, 3 and 7 tests from a fresh install.
- Exit: both install, boot, and serve 200 (via T106).

## T103 - Fastify templates (base + agent)

- [x] Same as T102 on Fastify, same route body.
- Evidence: fastify and fastify-agent templates, same tests.
- Exit: both install, boot, and serve the identical 200 (via T106).

## T104 - Verify script

- [x] `scaffolder/scripts/verify-scaffolder.mjs`: scaffolds all 4 templates in
  temp dirs, installs, boots, curls the route, runs template tests, scans for
  `@aimbrace/*` deps (any hit fails the build), enforces template count cap.
- Evidence: verify-scaffolder.mjs passes end to end.
- Exit: script passes end to end on this machine.

## T105 - Template tests

- [x] Per-template vitest suites: route test for all four, offline agent test
  for the two agent variants, refuse-overwrite test for the CLI.
- Evidence: per-template tests and CLI refusal test.
- Exit: suites green inside T106 runs.

## T106 - Workspace check wiring

- [ ] Scaffolder `check` (lint, build, template tests, verify script) wired so
  the repo gate covers it; frozen packages untouched.
- Exit: gate green.

## T107 - Quickstart page

- [x] `scaffolder/docs/quickstart.md`: zero to serving app on one page.
  A stranger (or fresh container) completes it in under 10 minutes.
- Evidence: quickstart in scaffolder/docs/quickstart.md.
- Exit: completed run plus time note in the ledger.

## T108 - npm publish

- [ ] (BLOCKED) `npm login` (owner) plus org, then `pnpm publish` of `create-aimbrace`;
  `npm view` resolves; fresh `npx create-aimbrace` works in an empty dir.
- Exit: version number recorded here. Blocked until the owner logs in.

## Cutover (explicitly NOT this milestone)

Old `packages/`, `plugins/`, `examples/` get deleted and the site shrinks only
after two real apps ship from the scaffolder. That decision gets its own spec.
