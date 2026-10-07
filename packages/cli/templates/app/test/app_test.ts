import { assertEquals, assertRejects } from '@std/assert'
import { type App, createApp } from '../src/app.ts'
import { APP_NAME } from '../src/plugins/routes.ts'

/** Boot the app on a free port, run the test, always stop it. */
async function withApp(test: (app: App) => Promise<void>) {
  const app = await createApp({ port: 0 })
  try {
    await test(app)
  } finally {
    await app.stop()
  }
}

Deno.test('serves the index route', () =>
  withApp(async (app) => {
    const response = await fetch(`${app.url}/`)
    assertEquals(response.status, 200)
    assertEquals(await response.json(), { app: APP_NAME, ok: true })
  }))

Deno.test('answers health checks', () =>
  withApp(async (app) => {
    const response = await fetch(`${app.url}/health`)
    assertEquals(response.status, 200)
    await response.body?.cancel()
  }))

Deno.test('returns 404 for unknown paths', () =>
  withApp(async (app) => {
    const response = await fetch(`${app.url}/nope`)
    assertEquals(response.status, 404)
    await response.body?.cancel()
  }))

Deno.test('rejects a body that is not JSON', () =>
  withApp(async (app) => {
    const response = await fetch(`${app.url}/`, { method: 'POST', body: '{' })
    assertEquals(response.status, 400)
    await response.body?.cancel()
  }))

Deno.test('stops listening when stopped', async () => {
  const app = await createApp({ port: 0 })
  await app.stop()
  await assertRejects(() => fetch(`${app.url}/health`))
})
