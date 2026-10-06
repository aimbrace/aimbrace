import { type App, createApp, definePlugin, type LeakProbe, service } from '@aimbrace/core'
import { describe, expect, it } from 'vitest'
import {
  assertClean,
  deferred,
  LeakError,
  mockService,
  recordHooks,
  startTestApp,
  waitFor,
  withApp,
} from '../src'

const Clock = service<{ now(): number }>('clock')
const Stamp = service<string>('stamp')

const stamper = definePlugin({
  id: 'stamper',
  requires: [Clock],
  provides: [Stamp],
  setup(ctx) {
    ctx.provide(Stamp, `t=${ctx.get(Clock).now()}`)
  },
})

describe('mockService', () => {
  it('provides a fixed value that other plugins can use', async () => {
    await withApp({ plugins: [mockService(Clock, { now: () => 7 }), stamper] }, (app) => {
      expect(app.get(Stamp)).toBe('t=7')
    })
  })

  it('names the plugin after the token unless told otherwise', async () => {
    const plugin = mockService(Clock, { now: () => 1 })
    expect(plugin.id).toBe('mock:clock')
    expect(mockService(Clock, { now: () => 1 }, 'custom').id).toBe('custom')
  })
})

describe('withApp', () => {
  it('returns the body result and leaves nothing behind', async () => {
    const value = await withApp({ plugins: [mockService(Clock, { now: () => 3 })] }, (app) =>
      app.get(Clock).now(),
    )
    expect(value).toBe(3)
  })

  it('stops the app and rethrows when the body throws', async () => {
    let captured: App | undefined
    await expect(
      withApp({ plugins: [mockService(Clock, { now: () => 3 })] }, (app) => {
        captured = app
        throw new Error('assertion failed')
      }),
    ).rejects.toThrow('assertion failed')
    expect(captured?.state).toBe('stopped')
    expect(captured?.probe().clean).toBe(true)
  })

  it('rethrows a start failure and rolls back', async () => {
    const broken = definePlugin({
      id: 'broken',
      setup: () => Promise.reject(new Error('no start')),
    })
    await expect(withApp({ plugins: [broken] }, () => {})).rejects.toThrow(/no start/)
  })
})

describe('startTestApp', () => {
  it('stops and checks for leaks when disposed', async () => {
    let app: App
    {
      await using t = await startTestApp({ plugins: [mockService(Clock, { now: () => 5 })] })
      app = t.app
      expect(t.app.get(Clock).now()).toBe(5)
      expect(t.hooks.names()).toContain('app:ready')
    }
    expect(app.state).toBe('stopped')
    expect(app.probe().clean).toBe(true)
  })
})

describe('assertClean and LeakError', () => {
  const dirty: LeakProbe = {
    plugins: 2,
    scopes: 0,
    services: 1,
    hooks: 0,
    registryEntries: 3,
    registrySubscribers: 0,
    fibers: 0,
    clean: false,
  }

  it('lists only the counters that are not zero', () => {
    const error = new LeakError(dirty)
    expect(error.message).toBe(
      'The app leaked resources after stop(): plugins=2, services=1, registryEntries=3.',
    )
    expect(error.code).toBe('E_LEAK')
    expect(error.probe).toBe(dirty)
  })

  it('throws for a dirty app and passes a clean one', async () => {
    expect(() => assertClean({ probe: () => dirty } as unknown as App)).toThrow(LeakError)
    const app = createApp()
    await app.start()
    await app.stop()
    expect(() => assertClean(app)).not.toThrow()
  })
})

describe('recordHooks', () => {
  it('records hook names and arguments in order, and can be cleared and stopped', async () => {
    const app = createApp({ plugins: [mockService(Clock, { now: () => 1 })] })
    const recorder = recordHooks(app)
    await app.start()
    expect(recorder.names()).toEqual([
      'graph:built',
      'app:starting',
      'plugin:install',
      'service:provide',
      'plugin:installed',
      'plugin:start',
      'plugin:started',
      'app:ready',
    ])
    expect(recorder.records.find((r) => r.name === 'plugin:install')?.args[0]).toMatchObject({
      id: 'mock:clock',
    })
    recorder.clear()
    expect(recorder.records).toHaveLength(0)
    recorder.stop()
    await app.stop()
    expect(recorder.records).toHaveLength(0)
  })
})

describe('waitFor and deferred', () => {
  it('resolves when the condition becomes true and times out otherwise', async () => {
    let ready = false
    setTimeout(() => {
      ready = true
    }, 20)
    expect(await waitFor(() => ready && 'done')).toBe('done')
    await expect(waitFor(() => false, 30)).rejects.toThrow(/timed out after 30ms/)
  })

  it('lets a promise be settled from outside', async () => {
    const d = deferred<number>()
    setTimeout(() => d.resolve(4), 5)
    expect(await d.promise).toBe(4)
    const failing = deferred()
    failing.reject(new Error('x'))
    await expect(failing.promise).rejects.toThrow('x')
  })
})
