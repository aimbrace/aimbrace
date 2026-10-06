import { createApp } from '@aimbrace/core'
import { get, http, routesPlugin, text } from '@aimbrace/http'
import { describe, expect, it } from 'vitest'
import { runHttpContract } from '../../http/test/contract'
import { HonoApp, honoHost } from '../src'

runHttpContract('hono', () => honoHost({ port: 0 }))

describe('honoHost specifics', () => {
  it('exposes the native Hono instance', async () => {
    const app = createApp({
      plugins: [http, honoHost({ port: 0 }), routesPlugin('r', [get('/x', () => text('x'))])],
    })
    await app.start()
    const hono = app.get(HonoApp)
    const response = await hono.request('/x')
    expect(await response.text()).toBe('x')
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('can be built without a socket', async () => {
    const app = createApp({
      plugins: [http, honoHost({ listen: false }), routesPlugin('r', [get('/x', () => text('x'))])],
    })
    await app.start()
    expect(app.get(HonoApp)).toBeDefined()
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('validates its config', async () => {
    const app = createApp({ plugins: [http, honoHost({ port: 70000 })] })
    await expect(app.start()).rejects.toThrow(/Invalid config for plugin "hono-host"/)
    expect(app.probe().clean).toBe(true)
  })

  it('fails to start, and rolls back, when the port is taken', async () => {
    const first = createApp({ plugins: [http, honoHost({ port: 0 })] })
    await first.start()
    const { HttpAddress } = await import('@aimbrace/http')
    const port = first.get(HttpAddress).port as number
    const second = createApp({ plugins: [http, honoHost({ port })] })
    await expect(second.start()).rejects.toThrow(/EADDRINUSE|address already in use/i)
    expect(second.probe().clean).toBe(true)
    await first.stop()
  })
})

describe('honoHost defaults', () => {
  it('accepts being used with no config at all', async () => {
    const app = createApp({ plugins: [http, honoHost] })
    const report = await app.validate()
    expect(report.ok).toBe(true)
  })
})
