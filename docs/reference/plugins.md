# Reference plugins

Four plugins that show the architecture on an agent system. Guide: [AI agents](../guides/ai-agents.md). Each package default-exports its main plugin.

## @aimbrace/plugin-model

| Export | |
|---|---|
| `model` | the plugin (also the default export); provides `Model`; config `{ provider? }` |
| `Model` | service: `complete(request, { signal?, provider? })`, `providers()` |
| `ModelProviders` | `registry<ModelProvider>`, keyed by `id` |
| `providerPlugin(id, provider)` | a plugin that registers a provider |
| `mockModel(options?)` | the mock provider as a plugin |
| `createMockProvider({ id?, delayMs? })` | the deterministic offline provider |
| `createScriptedProvider(id, responses)` | replays fixed responses, records `calls` |
| `respondMock(request)` | the mock's rules as a pure function |
| `sleep(ms, signal)` | wait, rejecting with `AbortError` when the signal aborts |
| `estimateTokens(text)` | four characters per token |
| `NoModelProviderError` | `E_NO_MODEL_PROVIDER` |

Types: `ModelProvider`, `ModelService`, `ModelRequest`, `ModelResponse`, `Message`, `Role`, `ToolCall`, `ToolSpec`, `Usage`, `FinishReason`, `CompleteOptions`, `MockProviderOptions`.
Hooks: `model:request`, `model:response`.

## @aimbrace/plugin-memory

| Export | |
|---|---|
| `memory` | the plugin; provides `Memory`; config `{ maxEntries? }` (default 1000) |
| `Memory` | service: `remember`, `recall`, `clear`, `size` |
| `TaskMemory` | service token for memory scoped to one task |
| `createMemoryStore(options?)` | the in-process store (keyword recall, bounded) |
| `createTaskMemory(namespace?)` | the same interface bound to one namespace |

Types: `MemoryService`, `MemoryEntry`, `MemoryStoreOptions`. Hook: `memory:write`.

## @aimbrace/plugin-tools

| Export | |
|---|---|
| `tools` | the plugin; provides `ToolRunner` |
| `ToolRunner` | service: `list()`, `call(name, args, { signal?, scope?, timeoutMs? })` returning a `ToolResult` |
| `Tools` | `registry<Tool>`, keyed by `name` |
| `defineTool(tool)` | identity helper that infers the argument type from `input` |
| `toolsPlugin(id, tools)` | a plugin that contributes tools |
| `builtinTools` | the `calculator` and `clock` tools as a plugin |
| `calculatorTool`, `clockTool(now?)` | the tools themselves |
| `calculate(expression)`, `formatNumber(value)` | the arithmetic parser and formatter |
| `CalculatorError` | thrown by `calculate` |

Types: `Tool`, `ToolContext`, `ToolDescription`, `ToolResult`, `ToolRunnerService`, `CallOptions`. Hooks: `tool:before`, `tool:after`.

## @aimbrace/plugin-agent

| Export | |
|---|---|
| `agent` | the plugin; requires `Model`, `Memory`, `ToolRunner`; provides `Agent`; config `{ maxSteps?, budgetTokens?, toolTimeoutMs?, systemPrompt? }` |
| `Agent` | service: `run(input, options?)`, `active()`, `cancel(id)`, `cancelAll()` |
| `BudgetToken` | service token for the task-local `Budget` |
| `Budget` | class: `limit`, `used`, `remaining`, `exceeded`, `spend(usage)` |

Types: `AgentService`, `AgentResult`, `AgentStep`, `AgentStatus`, `RunOptions` (`id`, `signal`, `budgetTokens`, `maxSteps`, `systemPrompt`). Hooks: `agent:start`, `agent:step`, `agent:end`.
