import { describe, expect, it } from 'vitest'
import {
  createApp,
  DuplicatePluginError,
  DuplicateProviderError,
  definePlugin,
  MissingDependencyError,
  PeerError,
  PluginError,
  type PluginInfo,
  type RegistryEvent,
  registry,
  service,
} from '../src'
import { sleep, waitFor } from './helpers'

interface Tool {
  name: string
  run(): string
}
const Tools = registry<Tool>('tools', { key: (tool) => tool.name })
const Db = service<{ id: string }>('db')
const Cache = service<{ id: string }>('cache')
const Agent = service<{ tools(): string[] }>('agent')

describe('registries owned by plugins', () => {
  const tool = (name: string): Tool => ({ name, run: () => name })
  const search = definePlugin({
    id: 'search',
    setup(ctx) {
      ctx.registry(Tools).add(tool('search'))
    },
  })
  const files = definePlugin({
    id: 'files',
    setup(ctx) {
      ctx.registry(Tools).add(tool('read'))
      ctx.registry(Tools).add(tool('write'))
    },
  })
  const agent = definePlugin({
    id: 'agent',
    provides: [Agent],
    setup(ctx) {
      // The registry is read when asked, so plugins that contribute later are still seen.
      ctx.provide(Agent, {
        tools: () =>
          ctx
            .registry(Tools)
            .all()
            .map((t) => t.name),
      })
    },
  })

  it('lets plugins contribute and another plugin enumerate without knowing them', async () => {
    const app = createApp({ plugins: [files, search] })
    await app.start()
    expect(
      app
        .registry(Tools)
        .all()
        .map((t) => t.name),
    ).toEqual(['read', 'write', 'search'])
    expect(app.inspect().registries).toEqual({ tools: 3 })
    await app.stop()
    expect(app.probe().registryEntries).toBe(0)
  })

  it('removes only the entries of a disposed plugin and notifies subscribers and the hook', async () => {
    const app = createApp()
    await app.start()
    const events: string[] = []
    app.registry(Tools).subscribe((event) => void events.push(`${event.type}:${event.id}`))
    const hookEvents: RegistryEvent[] = []
    app.hooks.hook('registry:change', (event) => void hookEvents.push(event))

    const a = await app.install(search)
    const b = await app.install(files)
    expect(app.registry(Tools).size).toBe(3)
    await b.dispose()
    expect(
      app
        .registry(Tools)
        .all()
        .map((t) => t.name),
    ).toEqual(['search'])
    expect(events).toEqual(['add:search', 'add:read', 'add:write', 'remove:write', 'remove:read'])
    await waitFor(() => hookEvents.length === 5)
    expect(hookEvents.map((e) => e.type)).toEqual(['add', 'add', 'add', 'remove', 'remove'])
    await a.dispose()
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('shows contributions made through a plugin the agent reads at start', async () => {
    const app = createApp({ plugins: [agent, search, files] })
    await app.start()
    expect(app.get(Agent).tools()).toEqual(['search', 'read', 'write'])
    await app.stop()
  })
})

describe('hooks', () => {
  it('registers the hooks a plugin declares only while it is installed', async () => {
    const seen: string[] = []
    const watcher = definePlugin({
      id: 'watcher',
      hooks: {
        'app:ready': () => void seen.push('ready'),
        'scope:open': (scope) => void seen.push(`scope:${scope.name}`),
      },
    })
    const app = createApp({ plugins: [watcher] })
    await app.start()
    expect(seen).toEqual(['ready'])
    expect(app.hooks.count()).toBe(2)
    await (await app.scope('t')).dispose()
    await waitFor(() => seen.length === 2)
    expect(seen).toEqual(['ready', 'scope:t'])
    await app.stop()
    expect(app.hooks.count()).toBe(0)
  })

  it('lets a plugin register hooks through ctx.hooks that vanish with it', async () => {
    const seen: string[] = []
    const watcher = definePlugin({
      id: 'watcher',
      setup(ctx) {
        ctx.hooks.hook('scope:open', () => void seen.push('opened'))
      },
    })
    const app = createApp()
    await app.start()
    const handle = await app.install(watcher)
    await (await app.scope('one')).dispose()
    await waitFor(() => seen.length === 1)
    await handle.dispose()
    expect(app.hooks.count()).toBe(0)
    await app.stop()
  })

  it('fires lifecycle hooks in the documented order', async () => {
    const events: string[] = []
    const make = (id: string, requires: (typeof Db)[] = [], provides: (typeof Db)[] = []) =>
      definePlugin({
        id,
        requires,
        provides,
        setup(ctx) {
          for (const token of provides) ctx.provide(token as never, { id } as never)
        },
      })
    const app = createApp({ plugins: [make('b', [Db]), make('a', [], [Db])] })
    const info = (p: PluginInfo) => p.id
    app.hooks.hook('graph:built', (graph) => void events.push(`graph:${graph.order.join('>')}`))
    app.hooks.hook('app:starting', () => void events.push('app:starting'))
    app.hooks.hook('plugin:install', (p) => void events.push(`install:${info(p)}`))
    app.hooks.hook('plugin:installed', (p) => void events.push(`installed:${info(p)}`))
    app.hooks.hook('plugin:start', (p) => void events.push(`start:${info(p)}`))
    app.hooks.hook('plugin:started', (p) => void events.push(`started:${info(p)}`))
    app.hooks.hook('app:ready', () => void events.push('app:ready'))
    app.hooks.hook('app:stopping', () => void events.push('app:stopping'))
    app.hooks.hook('plugin:stop', (p) => void events.push(`stop:${info(p)}`))
    app.hooks.hook('plugin:stopped', (p) => void events.push(`stopped:${info(p)}`))
    app.hooks.hook('plugin:dispose', (p) => void events.push(`dispose:${info(p)}`))
    app.hooks.hook('app:stopped', () => void events.push('app:stopped'))
    await app.start()
    await app.stop()
    expect(events).toEqual([
      'graph:a>b',
      'app:starting',
      'install:a',
      'installed:a',
      'install:b',
      'installed:b',
      'start:a',
      'started:a',
      'start:b',
      'started:b',
      'app:ready',
      'app:stopping',
      'stop:b',
      'stopped:b',
      'stop:a',
      'stopped:a',
      'dispose:b',
      'dispose:a',
      'app:stopped',
    ])
  })

  it('reports service provision through hooks', async () => {
    const provided: string[] = []
    const removed: string[] = []
    const db = definePlugin({
      id: 'db',
      provides: [Db],
      setup(ctx) {
        ctx.provide(Db, { id: 'x' })
      },
    })
    const app = createApp({ plugins: [db] })
    app.hooks.hook(
      'service:provide',
      (service, plugin) => void provided.push(`${service}@${plugin}`),
    )
    app.hooks.hook('service:remove', (service, plugin) => void removed.push(`${service}@${plugin}`))
    await app.start()
    await app.stop()
    await sleep(5)
    expect(provided).toEqual(['db@db'])
    expect(removed).toEqual(['db@db'])
  })

  it('fails the start when a lifecycle hook throws (hooks are part of the contract)', async () => {
    const app = createApp({ plugins: [definePlugin({ id: 'p' })] })
    app.hooks.hook('plugin:install', () => {
      throw new Error('policy says no')
    })
    const error = (await app.start().catch((e: unknown) => e)) as PluginError
    expect(error).toBeInstanceOf(PluginError)
    expect((error.cause as Error).message).toBe('policy says no')
    expect(app.probe().clean).toBe(true)
  })
})

describe('provider replacement and reactivation', () => {
  function build() {
    const log: string[] = []
    const db = (id: string) =>
      definePlugin({
        id,
        provides: [Db],
        setup(ctx) {
          ctx.provide(Db, { id })
        },
      })
    const agent = definePlugin({
      id: 'agent',
      requires: [Db],
      setup(ctx) {
        log.push(`setup:${ctx.get(Db).id}`)
        return () => void log.push('release')
      },
      start: () => void log.push('start'),
      stop: () => void log.push('stop'),
    })
    return { log, db, agent }
  }

  it('stops dependents when their provider goes away and restarts them when one returns', async () => {
    const { log, db, agent } = build()
    const app = createApp()
    await app.start()
    const first = await app.install(db('db-1'))
    await app.install(agent)
    expect(log).toEqual(['setup:db-1', 'start'])

    await first.dispose()
    await waitFor(() => app.inspect().plugins.find((p) => p.id === 'agent')?.state === 'pending')
    expect(log).toEqual(['setup:db-1', 'start', 'stop', 'release'])
    expect(app.maybe(Db)).toBeUndefined()

    await app.install(db('db-2'))
    await waitFor(() => app.inspect().plugins.find((p) => p.id === 'agent')?.state === 'running')
    expect(log).toEqual(['setup:db-1', 'start', 'stop', 'release', 'setup:db-2', 'start'])

    await app.stop()
    expect(app.probe().clean).toBe(true)
    expect(log.slice(-3)).toEqual(['start', 'stop', 'release'])
  })

  it('reports a failing reactivation through onError and marks the plugin failed', async () => {
    const reported: string[] = []
    let failNext = false
    const db = (id: string) =>
      definePlugin({ id, provides: [Db], setup: (ctx) => void ctx.provide(Db, { id }) })
    const agent = definePlugin({
      id: 'agent',
      requires: [Db],
      setup() {
        if (failNext) throw new Error('cannot reconnect')
      },
    })
    const app = createApp({
      onError: (error, where) => void reported.push(`${where}: ${(error as Error).message}`),
    })
    await app.start()
    const first = await app.install(db('db-1'))
    await app.install(agent)
    await first.dispose()
    await waitFor(() => app.inspect().plugins.find((p) => p.id === 'agent')?.state === 'pending')
    failNext = true
    await app.install(db('db-2'))
    await waitFor(() => app.inspect().plugins.find((p) => p.id === 'agent')?.state === 'failed')
    expect(
      reported.some(
        (line) => line.includes('plugin agent reactivation') && line.includes('cannot reconnect'),
      ),
    ).toBe(true)
    expect(app.inspect().plugins.find((p) => p.id === 'agent')?.error).toContain('cannot reconnect')
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })
})

describe('dynamic installation', () => {
  const db = definePlugin({
    id: 'db',
    provides: [Db],
    setup: (ctx) => void ctx.provide(Db, { id: 'db' }),
  })
  const consumer = definePlugin({
    id: 'consumer',
    requires: [Db],
    setup: (ctx) => void ctx.get(Db),
  })

  it('validates against what is provided now', async () => {
    const app = createApp()
    await app.start()
    const error = await app.install(consumer).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MissingDependencyError)
    expect(app.inspect().plugins).toEqual([])
    await app.install(db)
    const handle = await app.install(consumer)
    expect(handle.state).toBe('running')
    expect(app.inspect().plugins.map((p) => p.id)).toEqual(['db', 'consumer'])
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('rejects duplicate ids and duplicate providers', async () => {
    const app = createApp({ plugins: [db] })
    await app.start()
    await expect(app.install(db)).rejects.toBeInstanceOf(DuplicatePluginError)
    const rival = definePlugin({
      id: 'rival',
      provides: [Db],
      setup: (ctx) => void ctx.provide(Db, { id: 'rival' }),
    })
    await expect(app.install(rival)).rejects.toBeInstanceOf(DuplicateProviderError)
    await app.stop()
  })

  it('checks peers against live plugins', async () => {
    const logger = definePlugin({ id: 'logger', version: '1.4.0' })
    const needsLogger = definePlugin({ id: 'needs', peers: { logger: '^2.0.0' } })
    const app = createApp({ plugins: [logger] })
    await app.start()
    await expect(app.install(needsLogger)).rejects.toBeInstanceOf(PeerError)
    await app.stop()
  })

  it('disposes a dynamic plugin through its handle and rolls back a failing install', async () => {
    const boom = definePlugin({
      id: 'boom',
      provides: [Cache],
      setup(ctx) {
        ctx.provide(Cache, { id: 'c' })
        throw new Error('after providing')
      },
    })
    const app = createApp()
    await app.start()
    await expect(app.install(boom)).rejects.toBeInstanceOf(PluginError)
    expect(app.probe().clean).toBe(true)
    expect(app.maybe(Cache)).toBeUndefined()
    const handle = await app.install(db)
    await handle.dispose()
    expect(app.probe().clean).toBe(true)
    await app.stop()
  })
})

describe('nested installation and isolation', () => {
  /** A group installs a private Db and a reader of it. Db is encapsulated in the subtree. */
  function group(id: string, label: string, seen: string[]) {
    const privateDb = definePlugin({
      id: 'private-db',
      provides: [Db],
      setup: (ctx) => void ctx.provide(Db, { id: label }),
    })
    const reader = definePlugin({
      id: 'reader',
      requires: [Db],
      setup: (ctx) => void seen.push(`${id} reads ${ctx.get(Db).id}`),
    })
    return definePlugin({
      id,
      async setup(ctx) {
        await ctx.install(privateDb)
        await ctx.install(reader)
      },
    })
  }

  it('lets two subtrees each own a private copy of the same service, invisible outside', async () => {
    const seen: string[] = []
    const app = createApp()
    await app.start()
    await app.install(group('one', 'db-one', seen), undefined, { isolate: [Db] })
    await app.install(group('two', 'db-two', seen), undefined, { isolate: [Db] })
    expect(seen).toEqual(['one reads db-one', 'two reads db-two'])
    expect(app.maybe(Db)).toBeUndefined()
    expect(app.inspect().services.filter((s) => s.service === 'db')).toHaveLength(2)
    expect(app.inspect().plugins.map((p) => p.key)).toEqual([
      'one',
      'one/private-db',
      'one/reader',
      'two',
      'two/private-db',
      'two/reader',
    ])
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('disposes nested plugins before their parent, in reverse order', async () => {
    const log: string[] = []
    const child = (id: string) =>
      definePlugin({
        id,
        setup: () => () => void log.push(`dispose:${id}`),
        stop: () => void log.push(`stop:${id}`),
      })
    const parent = definePlugin({
      id: 'parent',
      async setup(ctx) {
        await ctx.install(child('c1'))
        await ctx.install(child('c2'))
        return () => void log.push('dispose:parent')
      },
      stop: () => void log.push('stop:parent'),
    })
    const app = createApp({ plugins: [parent] })
    await app.start()
    expect(app.inspect().plugins.map((p) => `${p.key}:${p.state}`)).toEqual([
      'parent:running',
      'parent/c1:running',
      'parent/c2:running',
    ])
    await app.stop()
    expect(log).toEqual([
      'stop:c2',
      'stop:c1',
      'stop:parent',
      'dispose:c2',
      'dispose:c1',
      'dispose:parent',
    ])
    expect(app.probe().clean).toBe(true)
  })

  it('lets a handle remove a nested plugin early', async () => {
    let handle: Awaited<ReturnType<typeof app.install>> | undefined
    const child = definePlugin({ id: 'child' })
    const parent = definePlugin({
      id: 'parent',
      async setup(ctx) {
        handle = await ctx.install(child)
      },
    })
    const app = createApp({ plugins: [parent] })
    await app.start()
    expect(app.inspect().plugins).toHaveLength(2)
    await handle?.dispose()
    expect(app.inspect().plugins.map((p) => p.id)).toEqual(['parent'])
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('fails the parent install when a nested install fails', async () => {
    const child = definePlugin({
      id: 'child',
      setup() {
        throw new Error('child broke')
      },
    })
    const parent = definePlugin({
      id: 'parent',
      async setup(ctx) {
        await ctx.install(child)
      },
    })
    const app = createApp({ plugins: [parent] })
    const error = (await app.start().catch((e: unknown) => e)) as PluginError
    // The failing child is blamed, not the parent whose setup merely awaited it.
    expect(error.plugin).toBe('child')
    expect((error.cause as Error).message).toBe('child broke')
    expect(app.probe().clean).toBe(true)
  })
})

describe('inspect and probe', () => {
  it('describes plugins, services and states', async () => {
    const db = definePlugin({
      id: 'db',
      version: '2.0.0',
      provides: [Db],
      setup: (ctx) => void ctx.provide(Db, { id: 'db' }),
    })
    const app = createApp({ name: 'demo', plugins: [db] })
    expect(app.inspect().state).toBe('created')
    await app.start()
    expect(app.inspect()).toMatchObject({
      name: 'demo',
      state: 'running',
      plugins: [
        {
          key: 'db',
          id: 'db',
          version: '2.0.0',
          state: 'running',
          parent: undefined,
          provides: ['db'],
        },
      ],
      services: [{ service: 'db', provider: 'db' }],
      scopes: [],
      registries: {},
    })
    await app.stop()
    expect(app.inspect().plugins).toEqual([])
  })

  it('keeps two apps in one process completely separate', async () => {
    const make = (label: string) =>
      definePlugin({
        id: 'db',
        provides: [Db],
        setup(ctx) {
          ctx.provide(Db, { id: label })
          ctx.registry(Tools).add({ name: label, run: () => label })
        },
      })
    const one = createApp({ plugins: [make('one')] })
    const two = createApp({ plugins: [make('two')] })
    await Promise.all([one.start(), two.start()])
    expect(one.get(Db).id).toBe('one')
    expect(two.get(Db).id).toBe('two')
    expect(
      one
        .registry(Tools)
        .all()
        .map((t) => t.name),
    ).toEqual(['one'])
    await one.stop()
    expect(two.get(Db).id).toBe('two')
    expect(two.probe().plugins).toBe(1)
    await two.stop()
  })
})

describe('ctx.report', () => {
  it('sends errors that cannot be thrown to the app error reporter', async () => {
    const reported: string[] = []
    const noisy = definePlugin({
      id: 'noisy',
      setup(ctx) {
        ctx.report(new Error('background failure'), 'noisy-task')
        ctx.report(new Error('default where'))
      },
    })
    const app = createApp({
      plugins: [noisy],
      onError: (error, where) => void reported.push(`${where}: ${(error as Error).message}`),
    })
    await app.start()
    expect(reported).toEqual(['noisy-task: background failure', 'plugin:noisy: default where'])
    await app.stop()
  })
})
