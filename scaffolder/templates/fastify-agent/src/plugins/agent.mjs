/**
 * The agent. Every run opens its own task fiber: a child of this plugin that holds the run's budget and is disposed when
 * the run ends, however it ends. That is the scope-per-task pattern, written with plain Cordis plugins.
 */
export const agent = {
  name: 'agent',
  inject: ['model', 'tools', 'memory'],
  apply(ctx) {
    let runs = 0
    ctx.provide('agent', {
      async run(question) {
        runs += 1
        let result
        const task = ctx.plugin({
          name: `task-${runs}`,
          inject: ['model', 'tools', 'memory'],
          async apply(scope) {
            const budget = { steps: 0, limit: 4 }
            scope.provide('budget', budget)
            let toolResult
            while (true) {
              if (budget.steps >= budget.limit) {
                result = { status: 'budget_exceeded', output: undefined, steps: budget.steps }
                return
              }
              budget.steps += 1
              const step = await scope.model.complete({ question, toolResult })
              if (!step.tool) {
                scope.memory.remember(`${question} => ${step.text}`)
                result = { status: 'completed', output: step.text, steps: budget.steps }
                return
              }
              toolResult = scope.tools.call(step.tool, step.args)
            }
          },
        })
        await task.await()
        await task.dispose()
        return result
      },
    })
  },
}
