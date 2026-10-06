# @aimbrace/testing

Test helpers. Depends on `@aimbrace/core`. Guide: [Test plugins](../guides/testing-plugins.md).

| Export | |
|---|---|
| `withApp(options, body)` | start, run `body(app)`, stop, assert clean; returns the body result |
| `startTestApp(options?)` | `{ app, hooks }` implementing `Symbol.asyncDispose` (stop and assert clean) |
| `mockService(token, value, id?)` | a plugin that provides a fixed value |
| `recordHooks(app)` | record every hook call: `records`, `names()`, `clear()`, `stop()` |
| `assertClean(app)` | throw `LeakError` unless `app.probe().clean` |
| `LeakError` | `code` `E_LEAK`, `probe`; the message lists the non-zero counters |
| `waitFor(check, timeout?)` | poll until truthy (default 2000 ms) |
| `deferred()` | `{ promise, resolve, reject }` |

Types: `TestApp`, `TestAppOptions`, `HookRecord`, `HookRecorder`, `Deferred`.
