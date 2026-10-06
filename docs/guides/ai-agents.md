# AI agents

The four reference plugins show the architecture on its own use case: an agent system. Nothing here talks to a model vendor;
the model is a deterministic mock so everything runs offline.

```text
Config -> Model (Registry<ModelProvider>) --\
          Memory ---------------------------+--> Agent  (one Task scope per run: Budget, TaskMemory, signal)
          Tools  (Registry<Tool>) ----------/
```

```ts docs-test
import assert from 'node:assert/strict'
import { Agent } from '@aimbrace/plugin-agent'
import agent from '@aimbrace/plugin-agent'
import memory, { Memory } from '@aimbrace/plugin-memory'
import model, { mockModel } from '@aimbrace/plugin-model'
import tools, { builtinTools } from '@aimbrace/plugin-tools'
import { startTestApp } from '@aimbrace/testing'

// Seven plugins, no wiring code: the graph is derived from requires and provides.
await using t = await startTestApp({ plugins: [model, memory, tools, builtinTools, mockModel(), agent] })
const app = t.app

assert.deepEqual(app.graph().dependenciesOf('agent').sort(), ['memory', 'model', 'tools'])

const result = await app.get(Agent).run('calc: 2 + 3 * 4')
assert.equal(result.status, 'completed')
assert.equal(result.output, 'The answer is 14.')
assert.deepEqual(result.steps.map((s) => `${s.kind}:${s.tool ?? ''}`), ['model:', 'tool:calculator', 'model:'])

// The run happened in its own scope and left nothing behind; the answer was remembered long term.
assert.equal(app.probe().scopes, 0)
assert.equal(app.get(Memory).recall('agent')[0]?.text, 'calc: 2 + 3 * 4 => The answer is 14.')
```

## The plugins

### `@aimbrace/plugin-model`

- `ModelProvider { id, complete(request, { signal }) }` is what a vendor adapter implements. Contribute one with
  `providerPlugin(id, provider)` (it enters the `ModelProviders` registry for as long as the plugin is installed).
- The `model` plugin provides `Model`: `complete(request, { signal?, provider? })` routes to a registered provider **at call time**
  (the configured default, a named one, or the first), fires `model:request` and `model:response`, and aborts the call when the
  caller aborts or the plugin is disposed.
- `createMockProvider({ id?, delayMs? })` and `mockModel()` are deterministic: after a tool result it answers `The answer is <result>.`;
  `calc: <expression>`, `time` and `note: <text>` call tools that exist; `loop` keeps calling `clock` (to exercise step limits);
  `expensive` reports a large usage (to exercise budgets); anything else is echoed.
- `createScriptedProvider(id, responses)` replays fixed responses and records the requests, for tests.

To write a real provider, implement `complete` with your SDK, map messages and tool calls, return `usage` and `finishReason`, and pass
`signal` to the SDK's fetch.

### `@aimbrace/plugin-memory`

`Memory` is a long-term, size-bounded store with keyword recall (`remember(namespace, text, tags?)`, `recall(namespace, query?, limit?)`,
`clear`, `size`) and fires `memory:write`. `createTaskMemory()` returns the same interface for one task; the agent provides it as the
scope-local `TaskMemory`.

### `@aimbrace/plugin-tools`

A `Tool` has `name`, `description`, an optional Standard Schema `input` and a `run(args, { signal, scope })`. Contribute tools with
`toolsPlugin(id, tools)`; they disappear when that plugin does. The `tools` plugin provides `ToolRunner`:

- arguments are validated with the tool's schema; unknown tools, invalid arguments, thrown errors, timeouts and aborts all become
  `ToolResult { isError: true, content }` for the model to read: **a tool call never crashes the caller**;
- `call(name, args, { signal, scope, timeoutMs })` races the tool against the signal and the timeout, so a tool that ignores its signal is
  still cut off;
- `tool:before` and `tool:after` fire with timing.

`builtinTools` adds `calculator`, which **parses** arithmetic with a small recursive descent parser (no `eval`, no `Function`), and `clock`.

### `@aimbrace/plugin-agent`

`Agent.run(input, { id?, signal?, budgetTokens?, maxSteps?, systemPrompt? })` returns an `AgentResult { id, status, output, steps, usage, messages }`.
**Every run opens `task:<id>`**, which:

- provides a scope-local `Budget` (`BudgetToken`) and `TaskMemory`, readable by tools through `ctx.scope.get(...)`;
- runs the model and tool loop, calling tools inside the task scope with the scope's signal;
- is disposed when the run ends, however it ends.

| Status | When |
|---|---|
| `completed` | the model answered |
| `max_steps` | the step limit was reached (`maxSteps`, default 6) |
| `budget_exceeded` | the budget was spent before a model call (`budgetTokens`, default 4000). The last call may overshoot; a finished answer is never discarded. |
| `cancelled` | the `signal` aborted, `cancel(id)` or `cancelAll()` was called, or the app is stopping |
| `error` | the provider threw; `error` holds the message |

`active()`, `cancel(id)` and `cancelAll()` manage runs in flight. Hooks: `agent:start`, `agent:step` (one per model call and tool call, with
tokens) and `agent:end`. After a completed run the agent remembers `input => output` and recalls related memories into later system prompts.

## Cancellation, three ways

```ts docs-test
import assert from 'node:assert/strict'
import { Agent } from '@aimbrace/plugin-agent'
import agent from '@aimbrace/plugin-agent'
import memory from '@aimbrace/plugin-memory'
import model, { mockModel } from '@aimbrace/plugin-model'
import tools from '@aimbrace/plugin-tools'
import { startTestApp, waitFor } from '@aimbrace/testing'

// A slow mock model, so there is something to cancel.
await using t = await startTestApp({ plugins: [model, memory, tools, mockModel({ delayMs: 5000 }), agent] })
const runs = t.app.get(Agent)

// 1. The caller's signal
const controller = new AbortController()
const byCaller = runs.run('hello', { signal: controller.signal })
await waitFor(() => t.app.probe().scopes === 1)
controller.abort()
assert.equal((await byCaller).status, 'cancelled')

// 2. By run id
const byId = runs.run('hello', { id: 'job-1' })
await waitFor(() => runs.active().includes('job-1'))
assert.equal(runs.cancel('job-1'), true)
assert.equal((await byId).status, 'cancelled')

// 3. App shutdown cancels in-flight runs (the `await using` above stops the app); scopes are released either way
assert.equal(t.app.probe().scopes, 0)
```

## Composing it differently

- **Add a tool**: `toolsPlugin('search', [searchTool])` installed before or after the agent starts; the next `run` sees it.
- **Add a provider**: `providerPlugin('anthropic', provider)`, then `model({ provider: 'anthropic' })` or `Model.complete(..., { provider })`.
- **Swap memory**: any plugin that provides the `Memory` token (a vector store, a database) replaces the in-process one.
- **Trace**: `app.hooks.hook('agent:step', ...)`, or `beforeEach` to see every hook.

## The two examples

- `examples/agent-cli`: the whole system as a seven-entry config; `aimbrace ask "calc: 2 + 3 * 4" --trace` runs it through a command a plugin contributes.
- `examples/http-agent`: the same plugins served by Hono or Fastify; `POST /ask`, `GET /tools`, and `POST /ask/stream` (Server-Sent Events). The request
  id becomes the run id, so a client that disconnects cancels the run and releases both the request scope and the task scope.
