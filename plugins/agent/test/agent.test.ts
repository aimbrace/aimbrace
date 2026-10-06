import { createApp, definePlugin } from '@aimbrace/core'
import memoryPlugin, { Memory, TaskMemory } from '@aimbrace/plugin-memory'
import modelPlugin, {
  createMockProvider,
  createScriptedProvider,
  type ModelResponse,
  mockModel,
  providerPlugin,
} from '@aimbrace/plugin-model'
import toolsPlugin, {
  builtinTools,
  toolsPlugin as contribute,
  defineTool,
} from '@aimbrace/plugin-tools'
import { recordHooks, startTestApp, waitFor, withApp } from '@aimbrace/testing'
import { describe, expect, it } from 'vitest'
import agentPlugin, { Agent, Budget, BudgetToken } from '../src'

const base = [modelPlugin, memoryPlugin, toolsPlugin, builtinTools]
const stack = (
  ...extra: Parameters<typeof createApp>[0] extends infer O
    ? NonNullable<(O & { plugins?: unknown })['plugins']>
    : never
) => [...base, mockModel(), agentPlugin, ...extra]

describe('a simple run', () => {
  it('answers, in its own scope that is gone afterwards, with hooks in order', async () => {
    await using t = await startTestApp({ plugins: stack() })
    const result = await t.app.get(Agent).run('hello there')
    expect(result.status).toBe('completed')
    expect(result.output).toBe('You said: hello there')
    expect(result.steps).toHaveLength(1)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(result.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant'])
    expect(t.app.probe().scopes).toBe(0)
    expect(t.app.get(Agent).active()).toEqual([])
    const names = t.hooks.names().filter((n) => n.startsWith('agent:') || n.startsWith('scope:'))
    expect(names).toEqual(['scope:open', 'agent:start', 'agent:step', 'agent:end', 'scope:close'])
  })

  it('uses a tool and feeds its result back to the model', async () => {
    await withApp({ plugins: stack() }, async (app) => {
      const result = await app.get(Agent).run('calc: 2 + 3 * 4')
      expect(result.status).toBe('completed')
      expect(result.output).toBe('The answer is 14.')
      expect(result.steps.map((s) => `${s.kind}:${s.tool ?? ''}`)).toEqual([
        'model:',
        'tool:calculator',
        'model:',
      ])
      expect(result.steps[1]).toMatchObject({ summary: '14', isError: false })
      expect(result.messages.map((m) => m.role)).toEqual([
        'system',
        'user',
        'assistant',
        'tool',
        'assistant',
      ])
      expect(result.messages[3]).toMatchObject({
        role: 'tool',
        toolCallId: 'call_1',
        content: '14',
      })
    })
  })

  it('survives a tool that fails: the model sees the error as a result', async () => {
    await withApp({ plugins: stack() }, async (app) => {
      const result = await app.get(Agent).run('calc: 1 / 0')
      expect(result.status).toBe('completed')
      expect(result.steps[1]).toMatchObject({ tool: 'calculator', isError: true })
      expect(result.output).toContain('Division by zero')
    })
  })

  it('traces steps through hooks with token usage', async () => {
    const seen: string[] = []
    const app = createApp({ plugins: stack() })
    app.hooks.hook(
      'agent:step',
      ({ id, step }) => void seen.push(`${id} ${step.kind} ${step.tool ?? '-'}`),
    )
    app.hooks.hook(
      'agent:end',
      (info) => void seen.push(`end ${info.status} ${info.steps} ${info.usage.outputTokens > 0}`),
    )
    await app.start()
    await app.get(Agent).run('calc: 2+3')
    expect(seen).toEqual([
      'run-1 model -',
      'run-1 tool calculator',
      'run-1 model -',
      'end completed 3 true',
    ])
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })
})

describe('the task scope', () => {
  it('provides a task-local Budget and TaskMemory that tools can read and that vanish afterwards', async () => {
    let inside: { budget: number; memory: number } | undefined
    const peek = defineTool({
      name: 'peek',
      description: 'Reads the task scope',
      run(_args, ctx) {
        const scope = ctx.scope
        const budget = scope?.get(BudgetToken)
        const memory = scope?.get(TaskMemory)
        inside = { budget: budget?.limit ?? -1, memory: memory?.size() ?? -1 }
        memory?.remember('x', 'peeked')
        return 'peeked'
      },
    })
    const script: ModelResponse[] = [
      {
        message: {
          role: 'assistant',
          content: 'peek',
          toolCalls: [{ id: 'c1', name: 'peek', arguments: {} }],
        },
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'tool_calls',
      },
      {
        message: { role: 'assistant', content: 'done' },
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'stop',
      },
    ]
    const app = createApp({
      plugins: [
        modelPlugin,
        memoryPlugin,
        toolsPlugin,
        contribute('peek', [peek]),
        providerPlugin('script', createScriptedProvider('s', script)),
        agentPlugin,
      ],
    })
    await app.start()
    const result = await app.get(Agent).run('go', { budgetTokens: 123 })
    expect(result.status).toBe('completed')
    expect(inside).toEqual({ budget: 123, memory: 0 })
    expect(app.maybe(BudgetToken)).toBeUndefined()
    expect(app.maybe(TaskMemory)).toBeUndefined()
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('gives concurrent runs independent scopes, budgets and ids', async () => {
    await using t = await startTestApp({ plugins: stack(mockModel({ id: 'slow', delayMs: 30 })) })
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, n) => t.app.get(Agent).run(`calc: ${n} * 2`)),
    )
    expect(results.map((r) => r.output)).toEqual([
      'The answer is 0.',
      'The answer is 2.',
      'The answer is 4.',
      'The answer is 6.',
      'The answer is 8.',
      'The answer is 10.',
    ])
    expect(new Set(results.map((r) => r.id)).size).toBe(6)
    expect(t.app.probe().scopes).toBe(0)
  })

  it('reports the scope while a run is in flight', async () => {
    await using t = await startTestApp({
      plugins: [...base, mockModel({ delayMs: 80 }), agentPlugin],
    })
    const pending = t.app.get(Agent).run('hello')
    await waitFor(() => t.app.inspect().scopes.length === 1)
    expect(t.app.inspect().scopes[0]?.name).toBe('task:run-1')
    expect(t.app.get(Agent).active()).toEqual(['run-1'])
    await pending
  })
})

describe('limits', () => {
  it('stops at maxSteps', async () => {
    await withApp({ plugins: stack() }, async (app) => {
      const result = await app.get(Agent).run('loop', { maxSteps: 3 })
      expect(result.status).toBe('max_steps')
      expect(result.steps.filter((s) => s.kind === 'model')).toHaveLength(3)
      expect(result.output).toBeUndefined()
    })
  })

  it('stops when the budget is spent, checked before each model call', async () => {
    await withApp({ plugins: stack() }, async (app) => {
      const result = await app.get(Agent).run('loop', { budgetTokens: 5, maxSteps: 10 })
      expect(result.status).toBe('budget_exceeded')
      expect(result.steps.filter((s) => s.kind === 'model')).toHaveLength(1)
      expect(app.probe().scopes).toBe(0)
    })
  })

  it('lets the last call overshoot rather than discarding a finished answer', async () => {
    await withApp({ plugins: stack() }, async (app) => {
      const result = await app.get(Agent).run('expensive', { budgetTokens: 100 })
      expect(result.status).toBe('completed')
      expect(result.usage.outputTokens).toBeGreaterThan(5000)
    })
  })

  it('takes defaults from config and options override them', async () => {
    const tight = agentPlugin({
      maxSteps: 2,
      budgetTokens: 4000,
      toolTimeoutMs: 1000,
      systemPrompt: 'terse',
    })
    await withApp({ plugins: [...base, mockModel(), tight] }, async (app) => {
      const result = await app.get(Agent).run('loop')
      expect(result.status).toBe('max_steps')
      expect(result.steps.filter((s) => s.kind === 'model')).toHaveLength(2)
      expect(result.messages[0]).toMatchObject({ role: 'system', content: 'terse' })
      expect(
        (await app.get(Agent).run('loop', { maxSteps: 1 })).steps.filter((s) => s.kind === 'model'),
      ).toHaveLength(1)
    })
    await expect(
      createApp({ plugins: [...base, mockModel(), agentPlugin({ maxSteps: 0 })] }).start(),
    ).rejects.toThrow(/Invalid config for plugin "agent"/)
  })
})

describe('cancellation', () => {
  it('stops when the caller aborts, interrupting the model call, and still disposes the scope', async () => {
    await using t = await startTestApp({
      plugins: [...base, mockModel({ delayMs: 5000 }), agentPlugin],
    })
    const controller = new AbortController()
    const started = performance.now()
    const pending = t.app.get(Agent).run('hello', { signal: controller.signal })
    await waitFor(() => t.app.probe().scopes === 1)
    controller.abort()
    const result = await pending
    expect(result.status).toBe('cancelled')
    expect(performance.now() - started).toBeLessThan(1000)
    expect(t.app.probe().scopes).toBe(0)
  })

  it('can be cancelled by run id', async () => {
    await using t = await startTestApp({
      plugins: [...base, mockModel({ delayMs: 5000 }), agentPlugin],
    })
    const agent = t.app.get(Agent)
    const pending = agent.run('hello')
    await waitFor(() => agent.active().length === 1)
    expect(agent.cancel('run-1')).toBe(true)
    expect(agent.cancel('run-1')).toBe(false)
    expect((await pending).status).toBe('cancelled')
    expect(agent.active()).toEqual([])
  })

  it('cancels everything with cancelAll', async () => {
    await using t = await startTestApp({
      plugins: [...base, mockModel({ delayMs: 5000 }), agentPlugin],
    })
    const agent = t.app.get(Agent)
    const runs = [agent.run('a'), agent.run('b'), agent.run('c')]
    await waitFor(() => agent.active().length === 3)
    agent.cancelAll()
    expect((await Promise.all(runs)).map((r) => r.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ])
  })

  it('cancels a tool call in flight', async () => {
    const hang = defineTool({
      name: 'hang',
      description: 'Never finishes on its own',
      run: (_args, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason)),
        ),
    })
    const script: ModelResponse[] = [
      {
        message: {
          role: 'assistant',
          content: 'hang',
          toolCalls: [{ id: 'c1', name: 'hang', arguments: {} }],
        },
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'tool_calls',
      },
    ]
    const app = createApp({
      plugins: [
        modelPlugin,
        memoryPlugin,
        toolsPlugin,
        contribute('hang', [hang]),
        providerPlugin('s', createScriptedProvider('s', script)),
        agentPlugin,
      ],
    })
    await app.start()
    const controller = new AbortController()
    const pending = app.get(Agent).run('go', { signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 30))
    controller.abort()
    expect((await pending).status).toBe('cancelled')
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('returns a cancelled result for a signal that is already aborted', async () => {
    await using t = await startTestApp({ plugins: stack() })
    const controller = new AbortController()
    controller.abort()
    expect(await t.app.get(Agent).run('hello', { signal: controller.signal })).toMatchObject({
      status: 'cancelled',
      steps: [],
    })
  })

  it('cancels in-flight runs when the app stops', async () => {
    const app = createApp({ plugins: [...base, mockModel({ delayMs: 5000 }), agentPlugin] })
    await app.start()
    const pending = app.get(Agent).run('hello')
    await waitFor(() => app.probe().scopes === 1)
    await app.stop()
    expect((await pending).status).toBe('cancelled')
    expect(app.probe().clean).toBe(true)
  })
})

describe('memory and errors', () => {
  it('remembers completed runs and recalls them into later runs', async () => {
    const provider = createScriptedProvider('s', [
      {
        message: { role: 'assistant', content: 'fine' },
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'stop',
      },
    ])
    const app = createApp({
      plugins: [modelPlugin, memoryPlugin, toolsPlugin, providerPlugin('s', provider), agentPlugin],
    })
    await app.start()
    await app.get(Agent).run('my favourite colour is green')
    expect(app.get(Memory).recall('agent')[0]?.text).toBe('my favourite colour is green => fine')
    await app.get(Agent).run('what colour do I like')
    const system = provider.calls[1]?.messages[0]?.content ?? ''
    expect(system).toContain('Relevant memory:')
    expect(system).toContain('my favourite colour is green => fine')
    await app.stop()
  })

  it('does not remember cancelled or failed runs', async () => {
    await using t = await startTestApp({
      plugins: [...base, mockModel({ delayMs: 5000 }), agentPlugin],
    })
    const controller = new AbortController()
    const pending = t.app.get(Agent).run('hello', { signal: controller.signal })
    await waitFor(() => t.app.probe().scopes === 1)
    controller.abort()
    await pending
    expect(t.app.get(Memory).size()).toBe(0)
  })

  it('reports a failing provider as an error result and still cleans up', async () => {
    const failing = { id: 'bad', complete: () => Promise.reject(new Error('rate limited')) }
    const app = createApp({
      plugins: [
        modelPlugin,
        memoryPlugin,
        toolsPlugin,
        providerPlugin('bad', failing),
        agentPlugin,
      ],
    })
    await app.start()
    const result = await app.get(Agent).run('hello')
    expect(result).toMatchObject({ status: 'error', error: 'rate limited' })
    expect(app.probe().scopes).toBe(0)
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('reports the missing provider clearly', async () => {
    const app = createApp({ plugins: [modelPlugin, memoryPlugin, toolsPlugin, agentPlugin] })
    await app.start()
    const result = await app.get(Agent).run('hello')
    expect(result.status).toBe('error')
    expect(result.error).toContain('No model provider is registered')
    await app.stop()
  })

  it('records the unknown tool a model asks for as an error step and carries on', async () => {
    const script: ModelResponse[] = [
      {
        message: {
          role: 'assistant',
          content: 'x',
          toolCalls: [{ id: 'c1', name: 'ghost', arguments: {} }],
        },
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'tool_calls',
      },
      {
        message: { role: 'assistant', content: 'recovered' },
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'stop',
      },
    ]
    const app = createApp({
      plugins: [
        modelPlugin,
        memoryPlugin,
        toolsPlugin,
        providerPlugin('s', createScriptedProvider('s', script)),
        agentPlugin,
      ],
    })
    await app.start()
    const result = await app.get(Agent).run('go')
    expect(result.status).toBe('completed')
    expect(result.steps[1]).toMatchObject({ kind: 'tool', tool: 'ghost', isError: true })
    expect(result.steps[1]?.summary).toContain('Unknown tool "ghost"')
    await app.stop()
  })
})

describe('composition', () => {
  it('has the dependency graph the architecture promises', () => {
    const app = createApp({ plugins: stack() })
    const graph = app.graph()
    expect(graph.ok).toBe(true)
    expect(graph.order.at(-1)).toBe('agent')
    expect(graph.dependenciesOf('agent').sort()).toEqual(['memory', 'model', 'tools'])
    expect(graph.toMermaid()).toContain('flowchart TD')
  })

  it('picks up tools and providers contributed after the agent started', async () => {
    await using t = await startTestApp({
      plugins: [modelPlugin, memoryPlugin, toolsPlugin, mockModel(), agentPlugin],
    })
    expect((await t.app.get(Agent).run('calc: 2+2')).output).toBe('You said: calc: 2+2')
    const handle = await t.app.install(builtinTools)
    expect((await t.app.get(Agent).run('calc: 2+2')).output).toBe('The answer is 4.')
    await handle.dispose()
    expect((await t.app.get(Agent).run('calc: 2+2')).output).toBe('You said: calc: 2+2')
  })

  it('is reusable across apps without sharing state', async () => {
    const one = createApp({ plugins: stack() })
    const two = createApp({ plugins: stack() })
    await Promise.all([one.start(), two.start()])
    await one.get(Agent).run('remember me')
    expect(one.get(Memory).size()).toBe(1)
    expect(two.get(Memory).size()).toBe(0)
    expect(two.get(Agent).active()).toEqual([])
    await Promise.all([one.stop(), two.stop()])
  })

  it('exposes Budget as a plain class', () => {
    const budget = new Budget(10)
    budget.spend({ inputTokens: 4, outputTokens: 3 })
    expect([budget.used, budget.remaining, budget.exceeded]).toEqual([7, 3, false])
    budget.spend({ inputTokens: 5, outputTokens: 0 })
    expect([budget.remaining, budget.exceeded]).toEqual([0, true])
    expect(definePlugin).toBeDefined()
    expect(recordHooks).toBeDefined()
    expect(createMockProvider().id).toBe('mock')
  })
})

describe('caller supplied run ids', () => {
  it('uses the given id for the run, its scope and its hooks, and refuses duplicates in flight', async () => {
    await using t = await startTestApp({
      plugins: [...base, mockModel({ delayMs: 60 }), agentPlugin],
    })
    const seen: string[] = []
    t.app.hooks.hook('agent:start', ({ id }) => void seen.push(id))
    const first = t.app.get(Agent).run('hello', { id: 'req-42' })
    await waitFor(() => t.app.inspect().scopes.length === 1)
    expect(t.app.inspect().scopes[0]?.name).toBe('task:req-42')
    await expect(t.app.get(Agent).run('again', { id: 'req-42' })).rejects.toThrow(
      /already in flight/,
    )
    expect((await first).id).toBe('req-42')
    expect(seen).toEqual(['req-42'])
    expect((await t.app.get(Agent).run('after', { id: 'req-42' })).status).toBe('completed')
  })
})
