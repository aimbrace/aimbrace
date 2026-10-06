import { defineConfig } from '@aimbrace/loader'

/**
 * An agent system as a list of plugins. Nothing here knows about the others:
 * the graph is derived from what each plugin requires and provides.
 *
 *   aimbrace graph --format mermaid     see the graph
 *   aimbrace check                      validate it
 *   aimbrace ask "calc: 2 + 3 * 4"      run the agent through a command a plugin contributes
 */
export default defineConfig({
  name: 'agent-cli',
  plugins: [
    '@aimbrace/plugin-model',
    '@aimbrace/plugin-memory',
    '@aimbrace/plugin-tools',
    './plugins/mock-model.mjs',
    './plugins/builtin-tools.mjs',
    { use: '@aimbrace/plugin-agent', config: { maxSteps: 6, budgetTokens: 4000 } },
    './plugins/ask.mjs',
  ],
})
