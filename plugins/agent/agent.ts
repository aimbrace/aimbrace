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
  /** The thinking model's reasoning for this call, kept so the next step can send it back. */
  readonly reasoning?: string
}

/** How a run ended, with every tool call it made. `task` is its durable record's id when the app records tasks. */
export type RunResult = (
  | { readonly status: 'completed'; readonly output: string }
  | { readonly status: 'budget_exceeded' }
  | { readonly status: 'cancelled' }
) & { readonly steps: number; readonly trace: readonly ToolCall[]; readonly task?: string }

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

/**
 * The part of a task recorder the agent uses. Optional: when an app mounts the `tasks` plugin, each run is a durable task and each
 * tool call a task it owns; without it, runs work the same and leave no record.
 */
interface TaskRecorder {
  start(
    kind: string,
    input: unknown,
    options?: { parent?: string },
  ): {
    readonly id: string
    readonly signal: AbortSignal
    progress(detail: unknown): void
    complete(result: unknown, detail?: unknown): void
    fail(error: unknown, detail?: unknown): void
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agent: Agent
    budget: Budget
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The agent. Every run is its own child fiber that holds the run's budget and is disposed when the run ends, however it ends: a
 * scope per task, written with plain Cordis plugins. A tool that throws does not end the run: the model sees the error as the result.
 * When the app records tasks, the run's record is written before the answer is returned, and cancelling it stops the run.
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
        const recorder = (ctx.get as (name: string) => unknown)('tasks') as TaskRecorder | undefined
        const record = recorder?.start('agent-run', { question })
        // Assigned inside the run's fiber; `as` keeps TypeScript from narrowing it to this first value.
        let result = { status: 'budget_exceeded', steps: 0, trace } as RunResult
        const task = ctx.plugin({
          name: `task-${runs}`,
          inject: ['model', 'tools', 'memory'],
          async apply(scope: Context) {
            scope.provide('budget', { steps: 0, limit } satisfies Budget)
            const budget = scope.budget
            let toolResult: unknown
            while (budget.steps < budget.limit) {
              if (record?.signal.aborted) {
                result = { status: 'cancelled', steps: budget.steps, trace }
                return
              }
              const step = await scope.model.complete({
                question,
                step: budget.steps,
                toolResult,
                trace: [...trace],
                tools: scope.tools.list(),
              })
              budget.steps += 1
              if (step.tool === undefined) {
                scope.memory.remember(`${question} => ${step.text}`)
                result = { status: 'completed', output: step.text, steps: budget.steps, trace }
                return
              }
              const call = record
                ? recorder?.start(`tool:${step.tool}`, step.input, { parent: record.id })
                : undefined
              try {
                toolResult = await scope.tools.call(step.tool, step.input)
                trace.push({
                  tool: step.tool,
                  input: step.input,
                  result: toolResult,
                  ...(step.reasoning !== undefined ? { reasoning: step.reasoning } : {}),
                })
                call?.complete(toolResult)
              } catch (error) {
                toolResult = { error: message(error) }
                trace.push({
                  tool: step.tool,
                  input: step.input,
                  error: message(error),
                  ...(step.reasoning !== undefined ? { reasoning: step.reasoning } : {}),
                })
                call?.fail(error)
              }
              record?.progress({ steps: budget.steps, trace })
            }
            result = { status: 'budget_exceeded', steps: budget.steps, trace }
          },
        })
        try {
          await task.await()
        } catch (error) {
          record?.fail(error, { trace })
          throw error
        } finally {
          await task.dispose()
        }
        if (result.status === 'completed')
          record?.complete(result.output, { steps: result.steps, trace })
        else if (result.status === 'budget_exceeded')
          record?.fail('the run used its whole step budget', { steps: result.steps, trace })
        return record ? { ...result, task: record.id } : result
      },
    } satisfies Agent)
  },
}
