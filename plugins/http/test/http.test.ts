import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { http } from '../index.ts'

test('routes answer, unknown paths are 404, and a route added in an effect leaves with its plugin', async () => {
  const root = new Context()
  await root.plugin(http).await()
  const owner = root.plugin({
    name: 'owner',
    inject: ['http'],
    apply(ctx: Context) {
      ctx.effect(() => ctx.http.route('GET', '/hello', () => ({ body: { hi: true } })))
    },
  })
  await owner.await()
  assert.deepEqual(await root.http.handle({ method: 'GET', path: '/hello', body: undefined }), {
    status: 200,
    body: { hi: true },
  })
  assert.equal(
    (await root.http.handle({ method: 'GET', path: '/nope', body: undefined })).status,
    404,
  )
  assert.deepEqual(root.http.list(), ['GET /hello'])
  await owner.dispose()
  assert.deepEqual(root.http.list(), [])
})

test('a route registered twice is refused', async () => {
  const root = new Context()
  await root.plugin(http).await()
  root.http.route('GET', '/', () => ({ body: 1 }))
  assert.throws(() => root.http.route('GET', '/', () => ({ body: 2 })), /already registered/)
})
