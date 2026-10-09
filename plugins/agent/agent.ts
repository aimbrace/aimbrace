import type { Context } from '@deepseek-ai/cordis'
import type {} from './memory.ts'
import type {} from './model.ts'
import type {} from './tools.ts'

/** One tool call made during a run. */
export interface ToolCall {
  readonly tool: string
  readonly input: unknown
  readonly result?: unknown
  readonly error?: string
}

/** How a run ended, with every tool call it made. */
export type RunResult =
  | {
      readonly status: 'completed'
      readonly output: string
      readonly steps: number
      readonly trace: readonly ToolCall[]
    }
  | {
      readonly status: 'budget_exceeded'
      readonly steps: number
      readonly trace: readonly ToolCall[]
    }

export interface Agent {
  run(question: string): Promise<RunResult>
}

/** The step budget of one run, provided inside the run's own fiber. */
export interface Budget {
  steps: number
  readonly limit: number
}

export interface AgentConfig {
  /** Steps per run before it stops. */
  steps?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agent: Agent
    budget: Budget
  }
}

/**
 * The agent. Every run is its own child fiber that holds the run's budget and is disposed when the run ends, however it ends: a
 * scope per task, written with plain Cordis plugins. A tool that throws does not end the run: the model sees the error as the result.
 */
export const agent = {
  name: 'agent',
  inject: ['model', 'tools', 'memory'],
  apply(ctx: Context, config?: AgentConfig) {
    const limit = config?.steps ?? 6
    let runs = 0
    ctx.provide('agent', {
      async run(question) {
        runs += 1
        const trace: ToolCall[] = []
        let result: RunResult = { status: 'budget_exceeded', steps: 0, trace }
        const task = ctx.plugin({
          name: `task-${runs}`,
          inject: ['model', 'tools', 'memory'],
          async apply(scope: Context) {
            scope.provide('budget', { steps: 0, limit } satisfies Budget)
            const budget = scope.budget
            let toolResult: unknown
            while (budget.steps < budget.limit) {
              const step = await scope.model.complete({ question, step: budget.steps, toolResult })
              budget.steps += 1
              if (step.tool === undefined) {
                scope.memory.remember(`${question} => ${step.text}`)
                result = { status: 'completed', output: step.text, steps: budget.steps, trace }
                return
              }
              try {
                toolResult = await scope.tools.call(step.tool, step.input)
                trace.push({ tool: step.tool, input: step.input, result: toolResult })
              } catch (error) {
                toolResult = { error: error instanceof Error ? error.message : String(error) }
                trace.push({
                  tool: step.tool,
                  input: step.input,
                  error: (toolResult as { error: string }).error,
                })
              }
            }
            result = { status: 'budget_exceeded', steps: budget.steps, trace }
          },
        })
        try {
          await task.await()
        } finally {
          await task.dispose()
        }
        return result
      },
    } satisfies Agent)
  },
}
