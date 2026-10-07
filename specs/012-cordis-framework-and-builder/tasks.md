# 012 tasks

A task closes when its evidence is on `main`.

## Phase 1

- [x] T120 Duplicate-library sweep: none in ACRYL; none in AIMBRACE (`hookable` only inside
      `tsdown`); stale copies dropped from `node_modules` by a clean reinstall.
- [x] T121 Templates on `@deepseek-ai/cordis` 4.0.4. Evidence: both templates pass from a fresh
      install.
- [x] T122 Docs examples run against `@deepseek-ai/cordis`. Evidence: six examples pass.
- [x] T123 Verify script and CLI test enforce `@deepseek-ai/cordis` as the only runtime dependency.
      Evidence: verify `OK`.
- [x] T124 Constitution 3.1.0. Gate green. Evidence: gate exit 0.

## Phase 1b (Deno)

- [x] T131 Constitution 4.0.0: Deno is the runtime. Evidence: constitution 4.0.0 on `main`.
- [x] T132 Templates in TypeScript on Deno: typed services, `Deno.serve`, `Deno.test`,
      least-privilege tasks. Evidence: `app` 5 and `agent` 9 tests pass under Deno sanitizers;
      `deno task check` passes in both scaffolded projects, also with a 64-character project name.
- [x] T133 CLI on Deno. Evidence: 12 CLI tests; `deno task aimbrace init` works from the repository
      root.
- [x] T134 Root `deno.json`, docs test and verify script on Deno; Node tooling removed. Evidence: 22
      repository tests including the six docs examples; no `package.json`, lockfile or Node
      configuration left.
- [x] T135 CI on Deno 2.9.7. `deno task check` green. Evidence: `deno task check` exit 0 on Deno
      2.9.7, ending `verify-scaffolder: OK`.

## Phase 2

- [ ] T125 `workspace` service and file tools, confined to `src/plugins/`.
- [ ] T126 `mount_plugin` with settled-state feedback.
- [ ] T127 Startup mounts `src/plugins/*.mjs`.
- [ ] T128 Scripted offline builder run in the template tests and the verify script (build, request,
      restart, request).
- [ ] T129 Optional OpenAI-compatible model plugin over `fetch`.

## Phase 3

- [ ] T130 Decide on Loader/hmr from Phase 2 evidence.
