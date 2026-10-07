import type { Context } from '@deepseek-ai/cordis'

/** How a run ended. */
export type RunResult =
  | { status: 'completed'; output: string; steps: number }
  | { status: 'budget_exceeded'; steps: number }

export interface Agent {
  run(question: string): Promise<RunResult>
}

/** The step budget of one run, provided inside the run's own fiber. */
export interface Budget {
  steps: number
  limit: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agent: Agent
    budget: Budget
  }
}

/**
 * The agent. Every run is its own child fiber that holds the run's budget and is disposed when the run ends, however
 * it ends: a scope per task, written with plain Cordis plugins.
 */
export const agent = {
  name: 'agent',
  inject: ['model', 'tools', 'memory'],
  apply(ctx: Context) {
    let runs = 0
    ctx.provide(
      'agent',
      {
        async run(question) {
          runs += 1
          let result: RunResult = { status: 'budget_exceeded', steps: 0 }
          const task = ctx.plugin({
            name: `task-${runs}`,
            inject: ['model', 'tools', 'memory'],
            async apply(scope: Context) {
              scope.provide('budget', { steps: 0, limit: 4 } satisfies Budget)
              const budget = scope.budget
              let toolResult: unknown
              while (budget.steps < budget.limit) {
                budget.steps += 1
                const step = await scope.model.complete({ question, toolResult })
                if (step.tool === undefined) {
                  scope.memory.remember(`${question} => ${step.text}`)
                  result = { status: 'completed', output: step.text, steps: budget.steps }
                  return
                }
                toolResult = scope.tools.call(step.tool, step.args)
              }
              result = { status: 'budget_exceeded', steps: budget.steps }
            },
          })
          try {
            await task.await()
          } finally {
            await task.dispose()
          }
          return result
        },
      } satisfies Agent,
    )
  },
}
