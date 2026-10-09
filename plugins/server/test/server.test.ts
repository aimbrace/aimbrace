import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { http } from '../../http/index.ts'
import { server } from '../index.ts'

async function boot(config: { port: number; scan?: boolean }) {
  const root = new Context()
  await root.plugin(http).await()
  root.http.route('GET', '/', () => ({ body: { ok: true } }))
  const fiber = root.plugin(server, config)
  await fiber.await()
  return { root, fiber }
}

test('serves the router, answers 400 on bad JSON, and closes on dispose', async () => {
  const { root, fiber } = await boot({ port: 0 })
  const url = root.server.url
  assert.deepEqual(await (await fetch(`${url}/`)).json(), { ok: true })
  const bad = await fetch(`${url}/`, { method: 'POST', body: '{' })
  assert.equal(bad.status, 400)
  await bad.body?.cancel()
  await fiber.dispose()
  await assert.rejects(fetch(`${url}/`))
})

test('moves to the next free port when asked to scan', async () => {
  const blocker = createServer()
  await new Promise<void>((done) => blocker.listen(0, '127.0.0.1', done))
  const taken = (blocker.address() as { port: number }).port
  try {
    const { root, fiber } = await boot({ port: taken, scan: true })
    assert.notEqual(root.server.port, taken)
    await fiber.dispose()
  } finally {
    await new Promise<void>((done) => blocker.close(() => done()))
  }
})
