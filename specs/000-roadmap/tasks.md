# Tasks: AIMBRACE roadmap ledger

Milestone-level ledger. Each milestone with its own spec folder carries the detailed task list
there. A milestone is only checked when its exit evidence (see `plan.md`) exists on `main`.

## M0 - Bootstrap

- [x] T000 Initialise spec-kit (`specify init --here --integration claude`)
- [x] T001 Constitution `.specify/memory/constitution.md`
- [x] T002 Roadmap spec, plan, research, tasks (`specs/000-roadmap`)
- [x] T003 Workspace tooling: pnpm workspace, tsconfig base, Biome, Vitest, CI workflow
- [x] T004 Root README with project summary and status table
- [x] T005 First checkpoint pushed to `aimbrace/aimbrace`

## M1 - Core primitives (`specs/001-core-primitives`)

- [x] done, see `specs/001-core-primitives/tasks.md`

## M2 - Plugin model and dependency graph (`specs/002-plugin-graph`)

- [x] done, see `specs/002-plugin-graph/tasks.md`

## M3 - App, Context, Scope, lifecycle (`specs/003-app-lifecycle`)

- [x] done, see `specs/003-app-lifecycle/tasks.md`

## M4 - Config and loader (`specs/004-config-loader`)

- [x] done (the brief's `config` package is folded into `@aimbrace/loader`), see `specs/004-config-loader/tasks.md`

## M5 - HTTP contract plus Hono and Fastify hosts (`specs/005-http-hosts`)

- [x] done, see `specs/005-http-hosts/tasks.md`

## M6 - Effect bridge and Unplugin build plugin (`specs/006-effect-unplugin`)

- [ ] see `specs/006-effect-unplugin/tasks.md`

## M7 - Testing package and CLI (`specs/007-testing-cli`)

- [ ] see `specs/007-testing-cli/tasks.md`

## M8 - Reference AI plugins and examples (`specs/008-ai-plugins`)

- [ ] see `specs/008-ai-plugins/tasks.md`

## M9 - Documentation (`specs/009-docs`)

- [ ] see `specs/009-docs/tasks.md`

## M10 - Website and release hygiene (`specs/010-website`)

- [ ] see `specs/010-website/tasks.md`
