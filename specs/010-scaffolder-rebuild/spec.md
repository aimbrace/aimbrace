# Feature Specification: create-aimbrace scaffolder (rebuild)

**Feature Branch**: `main` (maintainer workflow, no feature branches)

**Created**: 2026-10-06

**Status**: Draft

**Input**: User direction ("rebuild our own framework based on Cordis from scratch",
scaffolder shaped like create-better-t-stack) and the ponytail review in
[`./review.md`](./review.md). Supersedes the framework direction in
`docs/aimbrace_spec.md` for all new work; old code is frozen, not deleted.

## Summary

Ship one thing: `create-aimbrace`, a scaffolder CLI. It asks a few choices
(host, extras), copies a template, and the user gets a working Cordis app.
Templates depend on `cordis` and host libraries directly. There are zero
`@aimbrace/*` runtime dependencies by design: there is no runtime to publish,
version, or keep in sync. better-t-stack is the model (questionnaire plus templates,
no shipped runtime).

## Clarifications

### Session 2026-10-06

- Q: same repo or fresh repo for the scaffolder? → A: undecided (user rejected
  both options). Default: same repo, alongside the frozen code. Reversible.
- Q: delete or archive the old framework code? → A: undecided. Default: touch
  nothing until scaffolder cutover. Reversible.
- Q: shrink the website or leave it? → A: undecided. Default: leave it.
  Reversible.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scaffold and run a Hono app (Priority: P1)

A developer runs `npx create-aimbrace my-app`, picks the defaults, installs,
and starts a serving app built from Cordis plugins with routes contributed
through a plain registry.

**Why this priority**: this is the product. Everything else is a variant.

**Independent Test**: in an empty temp dir, run the scaffolder non-interactively
with host=hono, `pnpm install`, boot, HTTP GET returns 200, and the generated
`package.json` contains zero `@aimbrace/*` entries (a test scans it).

**Acceptance Scenarios**:

1. **Given** an empty directory, **When** the scaffolder runs with defaults,
   **Then** it writes a runnable project (config, one plugin, package.json)
   and prints next steps.
2. **Given** a non-empty directory, **When** the scaffolder runs, **Then** it
   refuses without overwriting anything.
3. **Given** the scaffolded project, **When** installed and started, **Then**
   its route responds 200 and Ctrl+C stops it cleanly.

### User Story 2 - Pick Fastify instead (Priority: P2)

Same story with host=fastify. Same route, same shape, other adapter.

**Independent Test**: repeat the US1 script with host=fastify; identical 200.

**Acceptance Scenarios**:

1. **Given** host=fastify, **When** scaffolded and started, **Then** the route
   responds 200 with the same body as the Hono variant.

### User Story 3 - Agent starter that runs offline (Priority: P2)

The developer ticks the `agent` extra and gets a mock model plus memory, tools
and one agent task scope, fully deterministic with no keys and no network.

**Independent Test**: the agent template's test suite passes offline.

**Acceptance Scenarios**:

1. **Given** the agent extra, **When** its tests run without network, **Then**
   they pass and no real vendor SDK is imported.

### User Story 4 - Publish and document in one page (Priority: P3)

`create-aimbrace` is on npm and one quickstart page takes a user from zero to
a serving app.

**Independent Test**: `npm view create-aimbrace` resolves and a fresh machine
(or container) completes the quickstart.

**Acceptance Scenarios**:

1. **Given** the npm package, **When** a user follows only the quickstart page,
   **Then** they reach a serving app in under 10 minutes.

## Edge Cases

- Target directory exists and is non-empty: refuse, exit non-zero, change nothing.
- Node below v22: fail fast with a one-line message.
- Offline machine: Hono/Fastify templates need registry access for install;
  document it, do not vendor node_modules.
- npm name `create-aimbrace` taken: fall back to `create-aimbrace-app`
  (assumption, recorded in implementation-spec-for-010.md).

## Functional Requirements

- **FR-001**: The CLI MUST ask for app name, host (`hono` | `fastify`) and
  extras (`agent` on/off), and MUST accept the same answers as flags for
  non-interactive runs.
- **FR-002**: A scaffolded `package.json` MUST contain zero `@aimbrace/*`
  dependencies (enforced by test).
- **FR-003**: Templates MUST use `cordis` Context and plugins directly; no
  wrapper runtime may be introduced.
- **FR-007**: Templates MUST depend on upstream `cordis` (exact pin
  `cordis@4.0.0-rc.10`) and MUST NOT depend on any `@deepseek-ai/*` package
  (no `@deepseek-ai/cordis`, `schemastery`, or `dsh-host-webserver`). Tutorial
  material reused from `cordis-interactive-tutorial` MUST have its dependency
  lines swapped to upstream `cordis`.
- **FR-004**: At most 4 templates: hono, hono+agent, fastify, fastify+agent.
- **FR-005**: The agent template MUST run offline with a deterministic mock
  and MUST NOT import a real vendor SDK.
- **FR-006**: A verify script MUST scaffold every template in a temp dir,
  install, boot, curl the route, and run the template tests.

## Success Criteria

- A new user goes from zero to a serving app in under 10 minutes by following
  only the quickstart page.
- Every scaffolded app has zero `@aimbrace/*` dependencies.
- The scaffolder's own `pnpm run check` is green.
- Template count stays at or under 4.
- No lines added to `packages/`, `plugins/` or `examples/` (frozen).

## Assumptions

- npm name `create-aimbrace` is available.
- Same repo, new top-level `scaffolder/` directory (CLI package plus
  `templates/` plus verify script), keeping the pnpm workspace green.
- Old code, docs and site stay exactly as they are until cutover.
