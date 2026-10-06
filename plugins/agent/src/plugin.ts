import { definePlugin, type Scope } from '@aimbrace/core'
import { createTaskMemory, Memory, TaskMemory } from '@aimbrace/plugin-memory'
import { type Message, Model, type ModelRequest, type Usage } from '@aimbrace/plugin-model'
import { ToolRunner } from '@aimbrace/plugin-tools'
import * as v from 'valibot'
import { Agent, BudgetToken } from './tokens'
import {
  type AgentResult,
  type AgentStatus,
  type AgentStep,
  Budget,
  type RunOptions,
} from './types'

const Shape = v.object({
  maxSteps: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 6),
  budgetTokens: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 4000),
  toolTimeoutMs: v.optional(v.pipe(v.number(), v.minValue(1)), 5000),
  systemPrompt: v.optional(v.string(), 'You are a helpful assistant. Use tools when they help.'),
})
const Config = v.optional(Shape, v.getDefaults(Shape))

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function clip(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}...` : text
}

/**
 * The agent. Every `run` opens its own scope (`task:<id>`) that carries a
 * `Budget` and a `TaskMemory`, calls the model, runs the tools the model asks
 * for inside that scope, and releases everything when the run ends, however it
 * ends: answer, step limit, budget, cancellation or error.
 */
export const agent = definePlugin({
  id: 'agent',
  version: '0.1.0',
  description: 'Tool-using agent with a scope per task',
  requires: [Model, Memory, ToolRunner],
  provides: [Agent],
  config: Config,
  setup(ctx, config) {
    const model = ctx.get(Model)
    const memory = ctx.get(Memory)
    const runner = ctx.get(ToolRunner)
    const running = new Map<string, AbortController>()
    let counter = 0

    async function loop(
      task: Scope,
      id: string,
      input: string,
      options: RunOptions,
    ): Promise<AgentResult> {
      const budget = new Budget(options.budgetTokens ?? config.budgetTokens)
      const taskMemory = createTaskMemory(id)
      task.provide(BudgetToken, budget)
      task.provide(TaskMemory, taskMemory)

      const recalled = memory.recall('agent', input, 3)
      const system = [
        options.systemPrompt ?? config.systemPrompt,
        ...(recalled.length > 0
          ? ['', 'Relevant memory:', ...recalled.map((entry) => `- ${entry.text}`)]
          : []),
      ].join('\n')
      const messages: Message[] = [
        { role: 'system', content: system },
        { role: 'user', content: input },
      ]
      const steps: AgentStep[] = []
      const total = { inputTokens: 0, outputTokens: 0 }
      const record = async (step: AgentStep) => {
        steps.push(step)
        await ctx.hooks.callHook('agent:step', { id, step })
      }
      let status: AgentStatus = 'max_steps'
      let output: string | undefined
      let error: string | undefined
      const maxSteps = options.maxSteps ?? config.maxSteps

      await ctx.hooks.callHook('agent:start', { id, input })
      try {
        for (let index = 1; index <= maxSteps; index++) {
          task.signal.throwIfAborted()
          if (budget.exceeded) {
            status = 'budget_exceeded'
            break
          }
          const request: ModelRequest = { messages, tools: runner.list() }
          const response = await model.complete(request, { signal: task.signal })
          budget.spend(response.usage)
          total.inputTokens += response.usage.inputTokens
          total.outputTokens += response.usage.outputTokens
          messages.push(response.message)
          await record({
            index,
            kind: 'model',
            summary: clip(response.message.content),
            tokens: response.usage,
          })
          if (response.finishReason !== 'tool_calls') {
            status = 'completed'
            output = response.message.content
            break
          }
          for (const call of response.message.toolCalls ?? []) {
            const result = await runner.call(call.name, call.arguments, {
              signal: task.signal,
              scope: task,
              timeoutMs: config.toolTimeoutMs,
            })
            task.signal.throwIfAborted()
            messages.push({ role: 'tool', toolCallId: call.id, content: result.content })
            taskMemory.remember(id, `${call.name} -> ${clip(result.content)}`)
            await record({
              index,
              kind: 'tool',
              tool: call.name,
              isError: result.isError,
              summary: clip(result.content),
            })
          }
        }
      } catch (caught) {
        if (isAbort(caught) || task.signal.aborted) {
          status = 'cancelled'
        } else {
          status = 'error'
          error = caught instanceof Error ? caught.message : String(caught)
        }
      }
      if (status === 'completed' && output !== undefined)
        memory.remember('agent', `${input} => ${clip(output, 300)}`)
      const usage: Usage = { ...total }
      await ctx.hooks.callHook('agent:end', { id, status, usage, steps: steps.length })
      return {
        id,
        status,
        output,
        steps,
        usage,
        messages,
        ...(error === undefined ? {} : { error }),
      }
    }

    ctx.provide(Agent, {
      active: () => [...running.keys()],
      cancel(id) {
        const controller = running.get(id)
        if (!controller || controller.signal.aborted) return false
        controller.abort()
        return true
      },
      cancelAll() {
        for (const controller of running.values()) controller.abort()
      },
      async run(input, options = {}) {
        const id = options.id ?? `run-${++counter}`
        if (running.has(id)) throw new Error(`A run with id "${id}" is already in flight.`)
        const own = new AbortController()
        running.set(id, own)
        const empty = (status: AgentStatus): AgentResult => ({
          id,
          status,
          output: undefined,
          steps: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          messages: [],
        })
        try {
          const signal = options.signal ? AbortSignal.any([own.signal, options.signal]) : own.signal
          let scope: Scope
          try {
            scope = await ctx.scope(`task:${id}`, { signal })
          } catch (error) {
            // Opening fails when the signal is already aborted or the agent is being disposed.
            if (signal.aborted || ctx.signal.aborted) return empty('cancelled')
            throw error
          }
          try {
            return await scope.run((task) => loop(task, id, input, options))
          } catch (error) {
            // The signal can fire between opening the scope and starting the loop.
            if (signal.aborted || ctx.signal.aborted) return empty('cancelled')
            throw error
          }
        } finally {
          running.delete(id)
        }
      },
    })
  },
})

export default agent
