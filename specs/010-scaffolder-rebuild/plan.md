# Implementation Plan: create-aimbrace scaffolder (M10)

**Branch**: `main` | **Date**: 2026-10-06 | **Spec**: [`./spec.md`](./spec.md)

## Summary

Build `scaffolder/` in this repo: one CLI package (`create-aimbrace`), at most
4 templates on raw Cordis, one verify script, one quickstart page. Old
`packages/`, `plugins/`, `examples/`, docs and site are frozen and untouched.
Each task below closes only with its exit evidence on `main`.

## Technical Context

**Language/Version**: TypeScript strict, ESM, Node `>=22`
**Dependencies**: upstream `cordis@4.0.0-rc.10` (exact pin, same as frozen
code), `hookable@6.1.2`, `hono` plus `@hono/node-server` OR `fastify` per
template (never both in one template), no `@aimbrace/*` deps anywhere, no
`@deepseek-ai/*` deps anywhere, no new runtime packages.
Reference clones (study only, never dependencies):
`../Cordis_Effect_Fastify_Hookable_Unplugin_Hono/` (upstream cordis, effect,
fastify, hono, hookable, unplugin checkouts)
**Testing**: vitest for the CLI; `scripts/verify-scaffolder.mjs` scaffolds every
template in a temp dir, installs, boots, curls the route, runs template tests
**Target**: Node 22+ only (hosts document their own targets; no Bun/Deno gate)
**Project Type**: single workspace package plus static template dirs
**Constraints**: FR-002/FR-004 enforced by tests (zero `@aimbrace/*` deps,
template count cap); refuse-to-overwrite behavior kept from current `init.ts`

## Constitution Check

The constitution (`.specify/memory/constitution.md`) currently mandates an
application composition runtime with `@aimbrace/core`. This milestone amends
it: the product is a scaffolder, templates use Cordis directly, no wrapper
runtime exists. Task T100 records the amendment (principle text + version bump)
before any code. If the amendment is rejected, this milestone stops: building a
scaffolder under a framework constitution would repeat the original error.

| Principle | Plan answer |
|---|---|
| Product shape | scaffolder plus templates, zero runtime packages |
| Cordis use | direct `Context`/plugin use in templates, no wrapper module |
| Dependency budget | template package.json scanned in CI, `@aimbrace/*` fails the build |
| Honest docs | one quickstart page; old docs frozen with a banner pointing at it |

## Architecture

```text
scaffolder/
  packages/create/        create-aimbrace (questionnaire, flags, file copy, refuse-if-dirty)
  templates/
    hono/                 base Cordis app on Hono
    hono-agent/           plus mock model, memory, tools, agent scope
    fastify/              base Cordis app on Fastify
    fastify-agent/        plus the same agent extra
  scripts/verify-scaffolder.mjs
  docs/quickstart.md      the single page from US4
```

Scaffold flow: parse flags (or ask) → resolve template dir → refuse if
target not empty → copy → write package.json with chosen name → print next
steps. No config parsing, no graph building, no plugin registry in the CLI:
it copies files. Salvage from frozen code: `hello` plugin shape (current
`packages/cli/src/builtins/init.ts`), leak-probe assertion
(`packages/testing`), consumer-check pattern
(`scripts/verify-consumer.mjs`), trimmed `first-app.md`.

## Project Structure (new files only)

```text
scaffolder/packages/create/src/{index.ts,questions.ts,copy.ts}
scaffolder/packages/create/package.json   (bin: create-aimbrace)
scaffolder/templates/{hono,hono-agent,fastify,fastify-agent}/
scaffolder/scripts/verify-scaffolder.mjs
scaffolder/docs/quickstart.md
specs/010-scaffolder-rebuild/{review.md,spec.md,plan.md,tasks.md,implementation-spec-for-010.md}
```

Nothing under `packages/`, `plugins/`, `examples/`, `docs/`, `specs/000-009`
changes except the roadmap ledger (`specs/000-roadmap/tasks.md`, M10 entry).
