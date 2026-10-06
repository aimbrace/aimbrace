# AIMBRACE Constitution

This constitution governs every spec, plan, task and package in this repository.
If another document conflicts with it, this file wins until it is deliberately
amended (with a version bump below).

**Version 2.0.0 (amended 2026-10-06).** Version 1.0.0 defined AIMBRACE as an
application composition runtime (`@aimbrace/core` and its siblings). That runtime
is now frozen (see `specs/010-scaffolder-rebuild/review.md`). The product going
forward is `create-aimbrace`: a scaffolder that copies small, working Cordis
projects. The reason is recorded in `specs/000-roadmap/research.md` (R9).

## Core Principles

### I. The product is scaffolded projects, not a runtime

The shipped artifact is a CLI that prompts for a few choices and copies a
template. There is no runtime library to version, publish or keep in sync. A new
feature is a new template choice or a change to an existing template, never a new
package that other projects import.

### II. Templates use Cordis directly; no wrapper

Templates import `cordis` and their host library (Hono or Fastify) directly. No
wrapper module, kernel, registry, graph or lifecycle layer is introduced between
the template and Cordis. Cordis is the composition model; the template shows it.

### III. Zero framework dependencies in a scaffolded project

A generated `package.json` contains no `@aimbrace/*` entry. Its runtime
dependencies are `cordis` and the one host library the template chose (plus
`@hono/node-server` for the Hono hosts). This is enforced by the verify script
and cannot be waived per template.

### IV. A small, fixed template set

At most four templates: `hono`, `hono-agent`, `fastify`, `fastify-agent`. A new
template needs a written reason in the spec and a removal candidate in the same
change. The count is enforced by the verify script.

### V. The verify script is the gate

`scaffolder/scripts/verify-scaffolder.mjs` scaffolds every template into a temp
directory, installs, boots the app, requests its route, and runs the template's
own tests. A template that does not pass it does not ship. The repository gate
runs it.

### VI. Offline and deterministic by default

The agent variants run with a deterministic mock model and no network. No
template imports a vendor SDK. A real provider is a line the user adds, not a
dependency the template ships with.

### VII. Frozen code stays frozen

The packages under `packages/`, `plugins/` and `examples/`, the framework docs,
and the website are not changed by scaffolder work. Deletion or archiving is a
separate decision with its own spec and happens only after two real apps ship
from the scaffolder.

### VIII. Smallest thing that works

No abstraction is added for a second use that does not exist yet. The scaffolder
copies files, substitutes the project name, and prints next steps. Anything more
needs a spec entry that says which real project needs it.

### IX. Test the behaviour a user sees

Each template is tested by booting it and requesting its route, not by mocking
Cordis. A scaffolded project that is not installed and started is not a passing
project.

### X. Honest specs and docs

Ledgers say what is done, what is blocked (for example npm publishing until the
owner logs in) and what is deferred. The quickstart describes only what the
verify script has run.

## Engineering rules

- Language: TypeScript for the CLI (strict, ESM), JavaScript ESM for the verify script. Node 22 or newer.
- Tooling: pnpm workspaces, Biome lint and format, Vitest for the CLI tests.
- Commits: small, coherent, conventional. Never add an AI agent as co-author.
- Never use the em dash character in code, comments, docs or commit messages.
- Do not hand-edit generated files or changelogs.
- Each task closes with its exit evidence on `main` and a pushed checkpoint.

## Governance

Amendments need a changed version line, a one-paragraph rationale in
`specs/000-roadmap/research.md`, and updates to any plan that they invalidate.

**Version**: 2.0.0 | **Ratified**: 2026-10-06 | **Last Amended**: 2026-10-06
