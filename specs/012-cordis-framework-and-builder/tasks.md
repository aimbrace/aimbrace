# 012 tasks

A task closes when its evidence is on `main`.

## Phase 1

- [x] T120 Duplicate-library sweep: none in ACRYL; none in AIMBRACE (`hookable` only inside `tsdown`); stale copies
  dropped from `node_modules` by a clean reinstall.
- [x] T121 Templates on `@deepseek-ai/cordis` 4.0.4. Evidence: both templates pass from a fresh install.
- [x] T122 Docs examples run against `@deepseek-ai/cordis`. Evidence: six examples pass.
- [x] T123 Verify script and CLI test enforce `@deepseek-ai/cordis` as the only runtime dependency. Evidence: verify `OK`.
- [x] T124 Constitution 3.1.0. Gate green. Evidence: gate exit 0.

## Phase 1b (Deno)

- [ ] T131 Constitution 4.0.0: Deno is the runtime.
- [ ] T132 Templates in TypeScript on Deno: typed services, `Deno.serve`, `Deno.test`, least-privilege tasks.
- [ ] T133 CLI on Deno.
- [ ] T134 Root `deno.json`, docs test and verify script on Deno; Node tooling removed.
- [ ] T135 CI on Deno 2.9.7. `deno task check` green.

## Phase 2

- [ ] T125 `workspace` service and file tools, confined to `src/plugins/`.
- [ ] T126 `mount_plugin` with settled-state feedback.
- [ ] T127 Startup mounts `src/plugins/*.mjs`.
- [ ] T128 Scripted offline builder run in the template tests and the verify script (build, request, restart, request).
- [ ] T129 Optional OpenAI-compatible model plugin over `fetch`.

## Phase 3

- [ ] T130 Decide on Loader/hmr from Phase 2 evidence.
