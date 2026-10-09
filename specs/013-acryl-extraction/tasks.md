# 013 tasks

A task closes when its evidence is on `main`.

- [x] T200 Deno work moved to branch `012-deno-runtime-experiment` (pushed); `main` reverted to Node (`ef1612f`,
  `129a201`); gate green: 22 tests, `verify-scaffolder: OK`.
- [x] T201 Spec 013 and constitution 5.0.0.
- [x] T202 P1: library shape (`plugins/{instance,http,server,agent}` with `plugin.json`), TypeScript templates on Node
  (`node:http`, `node:test`, no build), `aimbrace add`, `aimbrace plugins`. Evidence: 11 library tests, 17 CLI tests;
  verify: both templates npm-installed, type-checked, tested, booted in a pinned home and stopped. Docs still describe
  the old `.mjs` templates until T208.
- [x] T203 P2: settings, ported from `acryl-settings` (layers, atomic ordered writes, watch, `settings/updated`, settle
  on dispose). Evidence: 6 tests; verify adds it to a fresh app, installs and type-checks.
- [ ] T204 P3: extensions.
- [ ] T205 P4: builder and agent; the verify script proves the self-extension loop.
- [ ] T206 P5: manifest.
- [ ] T207 P6: save.
- [ ] T208 P7: docs.
