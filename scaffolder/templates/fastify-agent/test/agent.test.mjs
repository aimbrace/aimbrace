import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.mjs'

let app
afterEach(async () => {
  await app?.stop()
  app = undefined
})

const ask = (url, body) => fetch(`${url}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

/** Everything here runs offline: the model is deterministic and no vendor SDK is imported. */
describe('agent (offline)', () => {
  it('uses a tool and answers with its result', async () => {
    app = await createApp({ port: 0 })
    const response = await ask(app.url, { question: 'add 2 3' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'completed', output: 'The answer is 5.', steps: 2 })
  })

  it('answers plain questions in one step', async () => {
    app = await createApp({ port: 0 })
    expect(await (await ask(app.url, { question: 'hello' })).json()).toEqual({ status: 'completed', output: 'You said: hello', steps: 1 })
  })

  it('rejects a body without a question', async () => {
    app = await createApp({ port: 0 })
    expect((await ask(app.url, {})).status).toBe(400)
  })

  it('keeps a memory of completed answers', async () => {
    app = await createApp({ port: 0 })
    await ask(app.url, { question: 'hello' })
    expect(app.root.get('memory').size()).toBe(1)
  })
})
