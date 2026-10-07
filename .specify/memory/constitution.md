# AIMBRACE Constitution

This constitution governs every spec, plan, task and package in this repository. If another document conflicts with
it, this file wins until it is deliberately amended (with a version bump below).

**Version 4.0.0 (amended 2026-10-07).** 4.0.0 makes Deno the runtime, replacing Node (spec 012 amendment).

**Version 3.1.0 (amended 2026-10-07).** 3.1.0 names the Cordis package: the one ACRYL runs on (research R2).

**Version 3.0.0 (amended 2026-10-06).** Version 1 defined AIMBRACE as a composition runtime on Cordis plus five
libraries; version 2 as a scaffolder with Hono and Fastify templates. Both re-did what Cordis already provides and were
removed. The reason is in `specs/000-roadmap/research.md` (R1).

## Core Principles

### I. Cordis is the framework

Plugins, services, dependencies, lifecycle, cleanup, events and isolation come from Cordis. AIMBRACE never adds a
wrapper, kernel, registry, graph, lifecycle or event layer around it, and never adds a library that duplicates a Cordis
capability.

### II. The product is a command and its templates

The shipped artifact is the `aimbrace` command: `init` copies a template and fills in the project name. There is no
runtime package for apps to import.

### III. Generated projects depend on `@deepseek-ai/cordis` only

A generated project imports `@deepseek-ai/cordis`, pinned exactly, and nothing else at runtime; its tests may import
`@std/assert`. HTTP uses `Deno.serve`. A template that needs
anything else needs a written reason in its spec. The verify script enforces this.

### IIIa. Deno is the runtime

Everything runs on Deno: templates, the CLI, docs examples, tests and scripts, written in TypeScript and run without a
build. Deno's own `fmt`, `lint`, `check` and `test` are the toolchain. Every task declares the narrowest permissions that
work; nothing defaults to `-A` except where a task genuinely needs it, and then the task says why.

### IV. Two templates

`app` and `agent`. A new template needs a written reason in a spec and the name of the real app that asked for it.

### V. The verify script is the gate

`scripts/verify-scaffolder.mjs` scaffolds every template with the real CLI, installs it, runs its tests, boots it,
requests its routes and stops it. The repository gate runs it.

### VI. Offline and deterministic by default

The agent template uses a deterministic model and no network. No template imports a vendor SDK.

### VII. Smallest thing that works

No abstraction for a second use that does not exist yet.

### VIII. Test the behaviour a user sees

Templates are tested by booting them and requesting their routes, not by mocking Cordis. Docs examples are executed.

### IX. Honest specs and docs

Ledgers say what is done, blocked and deferred. Docs describe only what the tests run. Superseded specs live in
`specs/archive/` and nowhere else.

## Engineering rules

- TypeScript everywhere, run by Deno 2.9.7 or newer. No build step, no `package.json`.
- `deno fmt`, `deno lint`, `deno check`, `deno test`.
- Small, coherent, conventional commits. Never add an AI agent as co-author.
- Never use the em dash character in code, comments, docs or commit messages.
- Do not hand-edit generated files or changelogs.

## Governance

Amendments need a changed version line, a research note in `specs/000-roadmap/research.md`, and updates to any plan
they invalidate.

**Version**: 4.0.0 | **Ratified**: 2026-10-06 | **Last Amended**: 2026-10-07
