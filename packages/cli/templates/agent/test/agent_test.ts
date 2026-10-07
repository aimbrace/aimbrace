import { assertEquals } from '@std/assert'
import { type App, createApp } from '../src/app.ts'

/** Everything here runs offline: the model is deterministic and nothing is fetched except the app itself. */
async function withApp(test: (app: App) => Promise<void>) {
  const app = await createApp({ port: 0 })
  try {
    await test(app)
  } finally {
    await app.stop()
  }
}

const ask = (app: App, body: unknown) =>
  fetch(`${app.url}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

Deno.test('uses a tool and answers with its result', () =>
  withApp(async (app) => {
    const response = await ask(app, { question: 'add 2 3' })
    assertEquals(response.status, 200)
    assertEquals(await response.json(), {
      status: 'completed',
      output: 'The answer is 5.',
      steps: 2,
    })
  }))

Deno.test('answers plain questions in one step', () =>
  withApp(async (app) => {
    assertEquals(await (await ask(app, { question: 'hello' })).json(), {
      status: 'completed',
      output: 'You said: hello',
      steps: 1,
    })
  }))

Deno.test('rejects a body without a question', () =>
  withApp(async (app) => {
    const response = await ask(app, {})
    assertEquals(response.status, 400)
    await response.body?.cancel()
  }))

Deno.test('keeps a memory of completed answers', () =>
  withApp(async (app) => {
    await (await ask(app, { question: 'hello' })).body?.cancel()
    assertEquals(app.root.get('memory')?.size(), 1)
  }))
