import { commandsPlugin } from '@aimbrace/cli'
import { Agent } from '@aimbrace/plugin-agent'

/** `aimbrace ask <question...>`: a CLI command contributed by a plugin. It runs inside a scope of the started app. */
export default commandsPlugin('ask', [
  {
    name: 'ask',
    description: 'Ask the agent a question',
    usage: 'ask <question...> [--budget N] [--steps N] [--trace]',
    options: {
      budget: { type: 'string' },
      steps: { type: 'string' },
      trace: { type: 'boolean' },
    },
    async run(ctx) {
      const question = ctx.args.join(' ').trim()
      if (!question) {
        ctx.stderr.write('usage: aimbrace ask <question...>\n')
        return 2
      }
      const budget = ctx.values.budget === undefined ? undefined : Number(ctx.values.budget)
      const steps = ctx.values.steps === undefined ? undefined : Number(ctx.values.steps)
      const result = await ctx.scope.get(Agent).run(question, {
        ...(budget === undefined ? {} : { budgetTokens: budget }),
        ...(steps === undefined ? {} : { maxSteps: steps }),
        signal: ctx.scope.signal,
      })
      if (ctx.values.trace) {
        for (const step of result.steps) {
          ctx.stdout.write(
            `  [${step.index}] ${step.kind}${step.tool ? ` ${step.tool}` : ''}: ${step.summary}\n`,
          )
        }
      }
      if (result.output !== undefined) ctx.stdout.write(`${result.output}\n`)
      ctx.stdout.write(
        `(${result.status}, ${result.usage.inputTokens + result.usage.outputTokens} tokens)\n`,
      )
      return result.status === 'completed' ? 0 : 1
    },
  },
])
