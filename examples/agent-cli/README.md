# agent-cli

An agent system composed from plugins and driven through the AIMBRACE CLI. No model key, no network:
the model is a deterministic mock.

```sh
pnpm install && pnpm run build           # from the repository root
cd examples/agent-cli
npx aimbrace graph --format mermaid      # the dependency graph, derived from requires/provides
npx aimbrace check                       # validate graph and configs without running any setup
npx aimbrace ask "calc: 2 + 3 * 4" --trace
npx aimbrace ask "hello there"
npx aimbrace ask "loop" --steps 3        # hits the step limit
npx aimbrace ask "loop" --budget 5       # hits the token budget
npx aimbrace run --once --inspect        # start, show the observed plugin tree, stop
```

What to look at:

- `aimbrace.config.mjs` is the whole composition: seven entries, no wiring code.
- `plugins/ask.mjs` is a CLI command contributed by a plugin. It runs inside a scope of the started app and reads the agent with `ctx.scope.get(Agent)`.
- Each `ask` runs in its own task scope (`task:run-1`) carrying a token budget and task memory, released when the run ends.
