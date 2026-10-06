# Tasks: M10 scaffolding ledger

Spec: [`./spec.md`](./spec.md). Plan: [`./plan.md`](./plan.md).
A task closes only when its exit evidence exists on `main`.

Owner correction 2026-10-06: no separate `create-aimbrace` package. Scaffolding
ships inside the aimbrace CLI (`aimbrace init`). T101-T105 and T107 below were
built as a standalone package first; T109 rewires that content into aimbrace
and deletes the standalone package. Nothing is published separately (T108 dropped).

## T100 - Constitution amendment

- [x] Rewrite the product definition in `.specify/memory/constitution.md`
  (scaffolder, not composition runtime; templates on raw Cordis; no wrapper
  runtime) with a version bump.
- Evidence: constitution amendment 2.0.0, research R9.
- Exit: diff of the constitution plus this task checked.

## T101 - Questionnaire and copy logic (built standalone, rewired in T109)

- [x] Name/host/extras questionnaire plus matching flags, refuse-if-target-dirty,
  file copy with substitution, next-steps output.
- Evidence: 12 tests (built under `scaffolder/packages/create`, moved in T109).
- Exit: covered by T109.

## T102 - Hono templates (base + agent)

- [x] `hono` and `hono-agent`: Cordis app plus route; agent variant adds mock
  model, memory, tools, one task scope. Offline deterministic, no vendor SDK.
- Evidence: 3 and 7 tests from a fresh install (moved under `templates/` in T109).
- Exit: both install, boot, and serve 200 (via T109 verify).

## T103 - Fastify templates (base + agent)

- [x] Same as T102 on Fastify, same route body.
- Evidence: same tests (moved under `templates/` in T109).
- Exit: both install, boot, and serve the identical 200 (via T109 verify).

## T104 - Verify script

- [x] Verify script: scaffolds all 4 templates in temp dirs, installs, boots,
  curls the route, runs template tests, scans for `@aimbrace/*` deps (any hit
  fails the build), enforces template count cap.
- Evidence: passes end to end (moved to `scripts/verify-scaffolder.mjs` in T109).
- Exit: script passes end to end on this machine.

## T105 - Template tests

- [x] Per-template vitest suites: route test for all four, offline agent test
  for the two agent variants, refuse-overwrite test.
- Evidence: suites green (moved with templates in T109).
- Exit: suites green inside T109 verify runs.

## T106 - Workspace check wiring (superseded by T109)

- Superseded: the gate wiring happens as part of the rewire, not the standalone.

## T107 - Quickstart page

- [x] Zero to serving app on one page.
- Evidence: page content (moved into `docs/` in T109).
- Exit: completed run plus time note in the ledger (redone after rewire).

## T108 - npm publish (dropped)

- Dropped 2026-10-06: no separate package exists to publish. Scaffolding ships
  with the aimbrace CLI whenever it is released.

## T109 - Rewire into aimbrace (the actual deliverable)

- [ ] Move questionnaire plus copy logic into `packages/cli` by extending
  `init` (no new binary name); move the 4 templates to top-level `templates/`;
  move the verify script to `scripts/verify-scaffolder.mjs`; move the
  quickstart into `docs/`; delete `scaffolder/` entirely.
- [ ] Re-run the verify script end to end plus the repo gate, both green.
- Exit: `aimbrace init` offers host plus extras, all 4 templates verify green,
  `scaffolder/` gone, gate green.

## Cutover (explicitly NOT this milestone)

Old `packages/` runtime code (core, loader, hosts) gets deleted and the site
shrinks only after two real apps ship from `aimbrace init`. That decision gets
its own spec.
