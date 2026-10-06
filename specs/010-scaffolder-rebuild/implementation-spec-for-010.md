# Implementation work order: M10 rewire into aimbrace (T109)

## Situation

T100-T105 and T107 are done but were built as a standalone `scaffolder/`
package (`create-aimbrace`). Owner decision: no separate package. Everything
moves into the aimbrace CLI. The 4 commits on `main` stay as checkpoints; this
task rewires their content, it does not revert them.

## 1. Read first (before touching code)

1. `specs/010-scaffolder-rebuild/tasks.md` - T109 is the only open build task.
2. `specs/010-scaffolder-rebuild/spec.md` - FR-001 (`aimbrace init`),
   FR-002, FR-004, FR-007 (upstream `cordis@4.0.0-rc.10`, no `@deepseek-ai/*`).

## 2. Rewire (T109, one or two commits)

- Move the questionnaire plus copy logic from `scaffolder/packages/create`
  into `packages/cli` by extending the `init` command. No new binary name:
  the entry point is `aimbrace init` with host plus extras selection.
- Move the 4 templates to top-level `templates/`.
- Move the verify script to `scripts/verify-scaffolder.mjs`; repoint it at
  `aimbrace init` and the new template paths.
- Move the quickstart page into `docs/`.
- Delete `scaffolder/` entirely, including any workspace registration.
- Keep the template dependency lines exactly as verified (upstream `cordis`
  pin, no `@deepseek-ai/*`, no `@aimbrace/*` in generated apps).

## 3. Hard constraints

- No new package, no new binary name, nothing outside this repo.
- Do NOT touch runtime code (`packages/core`, `loader`, hosts, `effect`,
  `unplugin`), `plugins/`, `examples/`, old `docs/`, `specs/000-009`, or the
  sibling site repo. Only `packages/cli` (init extension), `templates/`,
  `scripts/`, `docs/quickstart.md` and `specs/010-*` may change.
- The directories under
  `../Cordis_Effect_Fastify_Hookable_Unplugin_Hono/` are study references,
  never dependencies.

## 4. Verify before pushing

Verify script end to end (all 4 templates: install, boot, curl 200, template
tests) plus the repo gate, both green. Paste the tail of the green run in the
report. Check off T109 in `specs/010-scaffolder-rebuild/tasks.md` in the same
commit. There is no T108 publish step: scaffolding ships with the aimbrace CLI.
