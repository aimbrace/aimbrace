# Implementation work order: M10 create-aimbrace scaffolder

Paste everything below the line to Claude. It assumes a checkout of the
`aimbrace/aimbrace` repo with the spec-kit structure intact.

---

You are building M10 in `/Users/musichen/_projects/p11_acr_agentcontextrelay/acryldev/acryl_blends_project/aimbrace-cordis-based-framework-experiments/aimbrace`.
Work autonomously, commit every green checkpoint to `main`, push each one.

## 1. Read first (in this order, before writing any code)

1. `specs/010-scaffolder-rebuild/review.md` - why the old direction is frozen.
2. `specs/010-scaffolder-rebuild/spec.md` - the full spec, everything testable.
3. `specs/010-scaffolder-rebuild/plan.md` - architecture and salvage list.
4. `specs/010-scaffolder-rebuild/tasks.md` - the ledger, work T100 first.
5. `specs/000-roadmap/tasks.md` (M10 entry) - check off each task as it lands.
6. Salvage sources only: `packages/cli/src/builtins/init.ts` (hello shape),
   `packages/testing/src/index.ts` (leak probe), `scripts/verify-consumer.mjs`
   (consumer-check pattern), `docs/getting-started/first-app.md` (trim source).

## 2. Build (tasks T100-T107, in order)

- T100: amend `.specify/memory/constitution.md` (product = scaffolder,
  templates on raw Cordis, no wrapper runtime) with a version bump. Stop and
  report if anything in the repo forbids this; do not code around it.
- T101-T103: `scaffolder/packages/create` (bin `create-aimbrace`, questionnaire plus
  flags, refuse-if-dirty) and 4 templates under `scaffolder/templates/`
  (hono, hono-agent, fastify, fastify-agent).
- T104-T106: `scaffolder/scripts/verify-scaffolder.mjs` (scaffold all four in
  temp dirs, install, boot, curl 200, run template tests, fail on any
  `@aimbrace/*` dep or a 5th template), per-template vitest suites, wire the
  repo gate to cover `scaffolder/`.
- T107: `scaffolder/docs/quickstart.md`, one page, zero to serving.

## 3. Hard constraints (ponytail rules, no exceptions)

- Templates import upstream `cordis@4.0.0-rc.10` (exact pin, same as frozen
  `packages/core`) and host libs directly. No `@deepseek-ai/*` package
  anywhere: when reusing tutorial material, swap its dependency lines to
  upstream `cordis`. No new runtime package, no wrapper module, no shared
  `@aimbrace/*` dependency in any template. The directories under
  `../Cordis_Effect_Fastify_Hookable_Unplugin_Hono/` are study references,
  never dependencies.
- At most 4 templates. A 5th idea goes in the ledger as rejected, not in code.
- Copy files, no config parsing, no graph building in the CLI.
- Do NOT touch `packages/`, `plugins/`, `examples/`, `docs/`,
  `specs/000-roadmap/spec.md`, `specs/001-*` through `specs/009-*`, or the
  sibling `aimbrace.github.io` repo. Only `scaffolder/`,
  `specs/010-scaffolder-rebuild/tasks.md` (ledger checkmarks) and
  `pnpm-workspace.yaml` may change.
- One template per commit where separable; every commit green.

## 4. Verify before each push

`verify-scaffolder.mjs` end to end plus the repo gate. Paste the tail of the
green run in your report. If `create-aimbrace` is taken on npm, use
`create-aimbrace-app` and record it in `tasks.md` T108.

## 5. Do NOT do T108 (npm publish)

Publishing needs the owner's `npm login` plus org. Finish T100-T107, push,
and report: green evidence, the publish command ready to run, and anything
that needs the owner.
