import { createApp } from '@aimbrace/core'
import { get, HttpAddress, http, post, routesPlugin, text } from '@aimbrace/http'
import { describe, expect, it } from 'vitest'
import { runHttpContract } from '../../http/test/contract'
import { FastifyApp, fastifyHost } from '../src'

runHttpContract('fastify', () => fastifyHost({ port: 0 }))

describe('fastifyHost specifics', () => {
  it('exposes the native Fastify instance (inject works)', async () => {
    const app = createApp({
      plugins: [
        http,
        fastifyHost({ port: 0 }),
        routesPlugin('r', [get('/x', () => text('x')), post('/y', () => text('y'))]),
      ],
    })
    await app.start()
    const injected = await app.get(FastifyApp).inject({ method: 'GET', url: '/x' })
    expect(injected.statusCode).toBe(200)
    expect(injected.body).toBe('x')
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('can be built without a socket', async () => {
    const app = createApp({
      plugins: [
        http,
        fastifyHost({ listen: false }),
        routesPlugin('r', [get('/x', () => text('x'))]),
      ],
    })
    await app.start()
    expect(app.get(HttpAddress).url).toBeUndefined()
    const injected = await app.get(FastifyApp).inject('/x')
    expect(injected.body).toBe('x')
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('validates its config', async () => {
    const app = createApp({ plugins: [http, fastifyHost({ port: -1 })] })
    await expect(app.start()).rejects.toThrow(/Invalid config for plugin "fastify-host"/)
    expect(app.probe().clean).toBe(true)
  })

  it('fails to start, and rolls back, when the port is taken', async () => {
    const first = createApp({ plugins: [http, fastifyHost({ port: 0 })] })
    await first.start()
    const port = first.get(HttpAddress).port as number
    const second = createApp({ plugins: [http, fastifyHost({ port })] })
    await expect(second.start()).rejects.toThrow(/EADDRINUSE|address already in use/i)
    expect(second.probe().clean).toBe(true)
    await first.stop()
  })
})
