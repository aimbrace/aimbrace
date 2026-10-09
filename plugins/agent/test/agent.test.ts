import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { agent, memory, model, tools } from '../index.ts'

async function boot() {
  const root = new Context()
  for (const plugin of [model, tools, memory, agent]) await root.plugin(plugin).await()
  return root
}

test('uses a tool and answers with its result in two steps', async () => {
  const root = await boot()
  assert.deepEqual(await root.agent.run('add 2 3'), {
    status: 'completed',
    output: 'The answer is 5.',
    steps: 2,
  })
})

test('answers a plain question in one step and remembers it', async () => {
  const root = await boot()
  assert.deepEqual(await root.agent.run('hello'), {
    status: 'completed',
    output: 'You said: hello',
    steps: 1,
  })
  assert.equal(root.memory.size(), 1)
})
