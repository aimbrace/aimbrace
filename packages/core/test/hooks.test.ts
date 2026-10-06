import { describe, expect, expectTypeOf, it } from 'vitest'
import { DisposerStack, Hooks } from '../src'

interface TestHooks {
  'run:start': (run: { id: string }) => void
  'run:end': (run: { id: string }, ok: boolean) => void | Promise<void>
  tick: () => void
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('Hooks', () => {
  it('calls hooks serially in registration order with the arguments', async () => {
    const hooks = new Hooks<TestHooks>()
    const seen: string[] = []
    hooks.hook('run:start', (run) => void seen.push(`a:${run.id}`))
    hooks.hook('run:start', async (run) => {
      await sleep(5)
      seen.push(`b:${run.id}`)
    })
    hooks.hook('run:start', (run) => void seen.push(`c:${run.id}`))
    await hooks.callHook('run:start', { id: '1' })
    expect(seen).toEqual(['a:1', 'b:1', 'c:1'])
  })

  it('stops a serial chain at the first failure and rejects', async () => {
    const hooks = new Hooks<TestHooks>()
    const seen: string[] = []
    hooks.hook('tick', () => void seen.push('a'))
    hooks.hook('tick', () => {
      throw new Error('boom')
    })
    hooks.hook('tick', () => void seen.push('c'))
    await expect(hooks.callHook('tick')).rejects.toThrow('boom')
    expect(seen).toEqual(['a'])
  })

  it('always returns a promise, even for synchronous hooks and no hooks', async () => {
    const hooks = new Hooks<TestHooks>()
    expect(hooks.callHook('tick')).toBeInstanceOf(Promise)
    hooks.hook('tick', () => {})
    expect(hooks.callHook('tick')).toBeInstanceOf(Promise)
    await hooks.callHookParallel('tick')
  })

  it('starts parallel hooks together', async () => {
    const hooks = new Hooks<TestHooks>()
    const events: string[] = []
    for (const name of ['a', 'b']) {
      hooks.hook('run:end', async () => {
        events.push(`${name}:start`)
        await sleep(5)
        events.push(`${name}:end`)
      })
    }
    await hooks.callHookParallel('run:end', { id: '1' }, true)
    expect(events.slice(0, 2)).toEqual(['a:start', 'b:start'])
    expect(events.slice(2).sort()).toEqual(['a:end', 'b:end'])
  })

  it('runs hookOnce at most once', async () => {
    const hooks = new Hooks<TestHooks>()
    let calls = 0
    hooks.hookOnce('tick', () => void calls++)
    await hooks.callHook('tick')
    await hooks.callHook('tick')
    expect(calls).toBe(1)
    expect(hooks.count('tick')).toBe(0)
  })

  it('counts live registrations and removes them with the returned function', () => {
    const hooks = new Hooks<TestHooks>()
    const off = hooks.hook('tick', () => {})
    hooks.hook('tick', () => {})
    hooks.hook('run:start', () => {})
    expect(hooks.count('tick')).toBe(2)
    expect(hooks.count()).toBe(3)
    expect(hooks.names().sort()).toEqual(['run:start', 'tick'])
    off()
    off()
    expect(hooks.count('tick')).toBe(1)
    hooks.clear()
    expect(hooks.count()).toBe(0)
  })

  it('removes scoped registrations when the owner is disposed', async () => {
    const hooks = new Hooks<TestHooks>()
    const owner = new DisposerStack()
    const scoped = hooks.scoped(owner)
    let calls = 0
    scoped.hook('tick', () => void calls++)
    scoped.hookOnce('run:start', () => void calls++)
    hooks.hook('tick', () => {})
    expect(hooks.count()).toBe(3)
    await scoped.callHook('tick')
    expect(calls).toBe(1)
    await owner.dispose()
    expect(hooks.count()).toBe(1)
    await hooks.callHook('tick')
    expect(calls).toBe(1)
  })

  it('does not double-count when a scoped hook is removed early', async () => {
    const hooks = new Hooks<TestHooks>()
    const owner = new DisposerStack()
    const off = hooks.scoped(owner).hook('tick', () => {})
    off()
    expect(hooks.count()).toBe(0)
    expect(owner.size).toBe(0)
    await owner.dispose()
  })

  it('exposes before and after observers', async () => {
    const hooks = new Hooks<TestHooks>()
    const log: string[] = []
    hooks.beforeEach((event) => void log.push(`before:${event.name}`))
    hooks.afterEach((event) => void log.push(`after:${event.name}`))
    hooks.hook('tick', () => void log.push('hook'))
    await hooks.callHook('tick')
    expect(log).toEqual(['before:tick', 'hook', 'after:tick'])
  })

  it('infers hook argument types', () => {
    const hooks = new Hooks<TestHooks>()
    expectTypeOf(hooks.callHook<'run:end'>).parameters.toEqualTypeOf<
      ['run:end', { id: string }, boolean]
    >()
    // @ts-expect-error unknown hook name
    hooks.hook('nope', () => {})
    // @ts-expect-error wrong callback signature
    hooks.hook('run:end', (_run: { wrong: number }) => {})
  })
})
