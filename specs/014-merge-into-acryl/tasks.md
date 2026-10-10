# 014 tasks

Each task is a branch of ACRYL. A task closes when its evidence exists on that branch and the owner has reviewed it.

- [x] T300 Upgrade planning in `runtime/blends-core` (`planUpgrade`, `applyUpgrade`), built on `resolveDefinition`. Done on the ACRYL
  branch `blends-upgrade-plan` (worktree `.worktrees/blends-upgrade-plan`), commits `dc9eed4` and `953be48`; 14 new tests, package check
  99 green, `check:layout` green. Local only: not pushed, not on `main`, awaiting the owner's review.
- [x] T301 (macOS) Sandbox spike: `--permission` works under Electron-as-Node, identically to Node; see `t301-sandbox-spike.md`.
  Open: Windows and Linux packaged builds, and the `ELECTRON_RUN_AS_NODE` hazard the port must handle.
- [ ] T302 `plugins/acryl-sandbox` and the `tool` kind (depends on T301).
- [ ] T303 Compare `tasks` with Harness `jobs`; decide.
- [ ] T304 Extension `check` and approval gate, designed with ACRYL's extension manifest.
- [ ] T305 Retire aimbrace: README pointer, archive note.
