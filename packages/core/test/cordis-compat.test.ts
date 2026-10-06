import { describe, expect, it } from 'vitest'
import {
  createRoot,
  FIBER_STATE,
  isolate,
  lookup,
  provide,
  serviceKey,
  spawn,
  spawnScope,
  trackedCallbacks,
} from '../src/internal/cordis'

/**
 * These tests pin the Cordis behaviours AIMBRACE relies on (see specs/000-roadmap/research.md R1).
 * If a Cordis upgrade breaks one of them, the runtime design must be revisited, not the test.
 */
describe('Cordis compatibility (cordis@4.0.0-rc.10)', () => {
  const key = serviceKey('db')

  it('prefixes service keys', () => {
    expect(key).toBe('aimbrace:db')
  })

  it('keeps a fiber pending until its injected service appears, then activates it', async () => {
    const root = createRoot()
    const log: string[] = []
    const consumer = spawn(root, {
      name: 'consumer',
      inject: [key],
      apply: () => void log.push('consumer'),
    })
    await consumer.await()
    expect(consumer.state).toBe(FIBER_STATE.PENDING)
    const provider = spawn(root, {
      name: 'provider',
      apply: (ctx) => void provide(ctx, key, { rows: 1 }),
    })
    await provider.await()
    await consumer.await()
    expect(provider.state).toBe(FIBER_STATE.ACTIVE)
    expect(consumer.state).toBe(FIBER_STATE.ACTIVE)
    expect(log).toEqual(['consumer'])
    expect(lookup(root, key)).toEqual({ rows: 1 })
  })

  it('returns a dependent to pending when its provider is disposed, and reactivates it later', async () => {
    const root = createRoot()
    let activations = 0
    const consumer = spawn(root, {
      name: 'consumer',
      inject: [key],
      apply: () => void activations++,
    })
    const first = spawn(root, { name: 'p1', apply: (ctx) => void provide(ctx, key, 1) })
    await first.await()
    await consumer.await()
    expect(activations).toBe(1)
    await first.dispose()
    await consumer.await()
    expect(consumer.state).toBe(FIBER_STATE.PENDING)
    expect(lookup(root, key)).toBeUndefined()
    const second = spawn(root, { name: 'p2', apply: (ctx) => void provide(ctx, key, 2) })
    await second.await()
    await consumer.await()
    expect(activations).toBe(2)
    expect(lookup(root, key)).toBe(2)
  })

  it('gives an isolated child its own namespace', async () => {
    const root = createRoot()
    const inner = isolate(root, key)
    const provider = spawn(inner, {
      name: 'private',
      apply: (ctx) => void provide(ctx, key, 'inner'),
    })
    await provider.await()
    expect(lookup(inner, key)).toBe('inner')
    expect(lookup(root, key)).toBeUndefined()
  })

  it('runs asynchronous apply to completion before the fiber settles', async () => {
    const root = createRoot()
    const events: string[] = []
    const fiber = spawn(root, {
      name: 'slow',
      apply: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        events.push('applied')
      },
    })
    await fiber.await()
    events.push('settled')
    expect(events).toEqual(['applied', 'settled'])
  })

  it('exposes a scope context whose fiber disposes its provided services', async () => {
    const root = createRoot()
    const { ctx, fiber } = await spawnScope(root, 'scope:a')
    provide(ctx, key, 'scoped')
    expect(lookup(root, key)).toBe('scoped')
    await fiber.dispose()
    expect(lookup(root, key)).toBeUndefined()
  })

  it('stops tracking callbacks once every fiber is disposed', async () => {
    const root = createRoot()
    expect(trackedCallbacks(root)).toBe(0)
    const a = spawn(root, { name: 'a', apply: () => {} })
    const b = spawn(root, { name: 'b', apply: () => {} })
    await a.await()
    await b.await()
    expect(trackedCallbacks(root)).toBe(2)
    await a.dispose()
    await b.dispose()
    expect(trackedCallbacks(root)).toBe(0)
  })

  it('reports the disposal order Cordis gives on its own (the gap AIMBRACE closes)', async () => {
    const root = createRoot()
    const order: string[] = []
    const provider = spawn(root, {
      name: 'db',
      apply: (ctx) => {
        provide(ctx, key, 1)
        return () => {
          order.push('db:dispose')
        }
      },
    })
    const consumer = spawn(root, {
      name: 'agent',
      inject: [key],
      apply: () => () => {
        order.push('agent:dispose')
      },
    })
    await provider.await()
    await consumer.await()
    await provider.dispose()
    await consumer.await()
    // Disposing a provider disposes the provider first; the dependent unloads afterwards.
    expect(order).toEqual(['db:dispose', 'agent:dispose'])
  })
})
