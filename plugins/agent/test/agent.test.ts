import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { agent, memory, model, scripted, tools } from '../index.ts'

async function boot() {
  const root = new Context()
  for (const plugin of [model, tools, memory, agent]) await root.plugin(plugin).await()
  return root
}

test('uses a tool and answers with its result, with the call in the trace', async () => {
  const root = await boot()
  assert.deepEqual(await root.agent.run('add 2 3'), {
    status: 'completed',
    output: 'The answer is 5.',
    steps: 2,
    trace: [{ tool: 'add', input: [2, 3], result: 5 }],
  })
})

test('answers a plain question in one step and remembers it', async () => {
  const root = await boot()
  const result = await root.agent.run('hello')
  assert.equal(result.status === 'completed' && result.output, 'You said: hello')
  assert.equal(root.memory.size(), 1)
})

test('a taught rule drives a multi-step run; a failing tool is reported to the model, not thrown', async () => {
  const root = await boot()
  const teacher = root.plugin({
    name: 'teacher',
    inject: ['model', 'tools'],
    apply(ctx: Context) {
      ctx.effect(() =>
        ctx.tools.register('fails', {
          description: 'always fails',
          run: () => Promise.reject(new Error('nope')),
        }),
      )
      ctx.effect(
        () =>
          scripted(ctx.model)?.teach(({ question, step, toolResult }) => {
            if (question !== 'try') return undefined
            return step === 0
              ? { tool: 'fails', input: {} }
              : { text: `got ${JSON.stringify(toolResult)}` }
          }) ?? (() => {}),
      )
    },
  })
  await teacher.await()
  const result = await root.agent.run('try')
  assert.equal(result.status === 'completed' && result.output, 'got {"error":"nope"}')
  assert.deepEqual(result.trace, [{ tool: 'fails', input: {}, error: 'nope' }])
  await teacher.dispose()
  assert.equal(
    (await root.agent.run('try')).status === 'completed' && (await root.agent.run('try')).steps,
    1,
  )
})

test('a run that never finishes stops at its budget', async () => {
  const root = new Context()
  for (const plugin of [model, tools, memory]) await root.plugin(plugin).await()
  await root.plugin(agent, { steps: 3 }).await()
  scripted(root.model)?.teach(() => ({ tool: 'add', input: [1, 1] }))
  const result = await root.agent.run('loop')
  assert.deepEqual([result.status, result.steps, result.trace.length], ['budget_exceeded', 3, 3])
})
