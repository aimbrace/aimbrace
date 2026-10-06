import { describe, expect, it } from 'vitest'
import {
  createApp,
  DisposedError,
  definePlugin,
  MissingServiceError,
  registry,
  type Scope,
  service,
} from '../src'
import { sleep } from './helpers'

interface Budget {
  tokens: number
}
const Budget = service<Budget>('budget')
const Clock = service<{ now(): number }>('clock')
const Tools = registry<{ name: string }>('tools', { key: (tool) => tool.name })

const clock = definePlugin({
  id: 'clock',
  provides: [Clock],
  setup(ctx) {
    ctx.provide(Clock, { now: () => 42 })
  },
})

async function running() {
  const app = createApp({ plugins: [clock] })
  await app.start()
  return app
}

describe('scopes', () => {
  it('opens a scope with an abort signal and a name', async () => {
    const app = await running()
    const scope = await app.scope('task:42')
    expect(scope.name).toBe('task:42')
    expect(scope.signal.aborted).toBe(false)
    expect(app.inspect().scopes).toHaveLength(1)
    expect(app.probe().scopes).toBe(1)
    await scope.dispose()
    expect(scope.signal.aborted).toBe(true)
    expect(scope.disposed).toBe(true)
    expect(app.inspect().scopes).toHaveLength(0)
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('carries scope-local services in front of app services', async () => {
    const app = await running()
    const scope = await app.scope('task')
    scope.provide(Budget, { tokens: 100 })
    expect(scope.get(Budget)).toEqual({ tokens: 100 })
    expect(scope.get(Clock).now()).toBe(42)
    expect(app.maybe(Budget)).toBeUndefined()
    expect(() => scope.get(service<number>('absent'))).toThrow(MissingServiceError)
    expect(scope.maybe(service<number>('absent'))).toBeUndefined()
    await scope.dispose()
    await app.stop()
  })

  it('lets child scopes read the parent scope and shadow it', async () => {
    const app = await running()
    const parent = await app.scope('parent')
    parent.provide(Budget, { tokens: 10 })
    const child = await parent.scope('child')
    expect(child.get(Budget).tokens).toBe(10)
    child.provide(Budget, { tokens: 1 })
    expect(child.get(Budget).tokens).toBe(1)
    expect(parent.get(Budget).tokens).toBe(10)
    await parent.dispose()
    expect(child.disposed).toBe(true)
    await app.stop()
  })

  it('keeps concurrent sibling scopes independent even for the same service', async () => {
    const app = await running()
    const scopes = await Promise.all([app.scope('a'), app.scope('b'), app.scope('c')])
    for (const [index, scope] of scopes.entries()) scope.provide(Budget, { tokens: index })
    expect(scopes.map((scope) => scope.get(Budget).tokens)).toEqual([0, 1, 2])
    await Promise.all(scopes.map((scope) => scope.dispose()))
    expect(() => scopes[0]?.provide(Budget, { tokens: 9 })).toThrow(DisposedError)
    await app.stop()
  })

  it('rejects null services and duplicate local provides, and removes a service early', async () => {
    const app = await running()
    const scope = await app.scope('task')
    expect(() => scope.provide(Budget, null as never)).toThrow(/null or undefined/)
    const remove = scope.provide(Budget, { tokens: 1 })
    expect(() => scope.provide(Budget, { tokens: 2 })).toThrow(/already provided/)
    remove()
    expect(scope.maybe(Budget)).toBeUndefined()
    await scope.dispose()
    await app.stop()
  })

  it('aborts first, then releases resources newest first, children before parents', async () => {
    const app = await running()
    const log: string[] = []
    const parent = await app.scope('parent')
    parent.own(() => void log.push('parent:first-registered'))
    const child = await parent.scope('child')
    child.own(() => void log.push('child:resource'))
    parent.own(() => void log.push('parent:last-registered'))
    parent.signal.addEventListener('abort', () => log.push('parent:abort'))
    child.signal.addEventListener('abort', () => log.push('child:abort'))
    await parent.dispose()
    expect(log).toEqual([
      'parent:abort',
      'parent:last-registered',
      'child:abort',
      'child:resource',
      'parent:first-registered',
    ])
    await app.stop()
  })

  it('removes registry entries and hook registrations made through the scope', async () => {
    const app = await running()
    const scope = await app.scope('task')
    scope.registry(Tools).add({ name: 'search' })
    let calls = 0
    scope.hooks.hook('scope:open', () => void calls++)
    expect(app.registry(Tools).size).toBe(1)
    expect(app.hooks.count('scope:open')).toBe(1)
    await scope.dispose()
    expect(app.registry(Tools).size).toBe(0)
    expect(app.hooks.count('scope:open')).toBe(0)
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('run() disposes the scope after success and after failure', async () => {
    const app = await running()
    let captured: Scope | undefined
    const result = await (await app.scope('ok')).run(async (scope) => {
      captured = scope
      await sleep(1)
      return 7
    })
    expect(result).toBe(7)
    expect(captured?.disposed).toBe(true)

    let failed: Scope | undefined
    await expect(
      (await app.scope('bad')).run((scope) => {
        failed = scope
        throw new Error('task failed')
      }),
    ).rejects.toThrow('task failed')
    expect(failed?.disposed).toBe(true)
    expect(app.probe().scopes).toBe(0)
    await app.stop()
  })

  it('supports await using', async () => {
    const app = await running()
    let ended: Scope
    {
      await using scope = await app.scope('task')
      ended = scope
      scope.provide(Budget, { tokens: 1 })
    }
    expect(ended.disposed).toBe(true)
    await app.stop()
  })

  it('disposes when an external signal aborts, and refuses an already aborted one', async () => {
    const app = await running()
    const controller = new AbortController()
    const scope = await app.scope('linked', { signal: controller.signal })
    controller.abort()
    await sleep(10)
    expect(scope.disposed).toBe(true)
    await expect(app.scope('late', { signal: controller.signal })).rejects.toThrow()
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('cannot open a scope under a disposed parent', async () => {
    const app = await running()
    const parent = await app.scope('parent')
    await parent.dispose()
    await expect(parent.scope('child')).rejects.toBeInstanceOf(DisposedError)
    await app.stop()
  })

  it('disposes open scopes when the app stops, before plugins stop', async () => {
    const log: string[] = []
    const app = createApp({
      plugins: [
        definePlugin({
          id: 'worker',
          stop: () => void log.push('plugin:stop'),
        }),
      ],
    })
    await app.start()
    const task = await app.scope('in-flight')
    task.own(() => void log.push('task:released'))
    task.signal.addEventListener('abort', () => log.push('task:abort'))
    await app.stop()
    expect(log).toEqual(['task:abort', 'task:released', 'plugin:stop'])
    expect(task.disposed).toBe(true)
    expect(app.probe().clean).toBe(true)
  })

  it('opens scopes from inside a plugin and disposes them with the plugin', async () => {
    let scope: Scope | undefined
    const host = definePlugin({
      id: 'host',
      async setup(ctx) {
        scope = await ctx.scope('owned-by-plugin')
        scope.provide(Budget, { tokens: 5 })
      },
    })
    const app = createApp({ plugins: [host] })
    await app.start()
    expect(scope?.get(Budget).tokens).toBe(5)
    await app.stop()
    expect(scope?.disposed).toBe(true)
    expect(app.probe().clean).toBe(true)
  })

  it('installs a plugin into a scope; it ends with the scope', async () => {
    const log: string[] = []
    const worker = definePlugin({
      id: 'worker',
      requires: [Clock],
      setup(ctx) {
        log.push(`setup:${ctx.get(Clock).now()}`)
        return () => void log.push('dispose')
      },
    })
    const app = await running()
    const scope = await app.scope('task')
    const handle = await scope.install(worker)
    expect(handle.state).toBe('running')
    expect(app.inspect().plugins.map((p) => p.id)).toEqual(['clock', 'worker'])
    await scope.dispose()
    expect(log).toEqual(['setup:42', 'dispose'])
    expect(app.inspect().plugins.map((p) => p.id)).toEqual(['clock'])
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })
})
