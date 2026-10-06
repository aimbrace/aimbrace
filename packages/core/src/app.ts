import type { InstallOptions, PluginHandle, Scope, ScopeOptions } from './context'
import type { AppHooks, PluginState } from './core-hooks'
import {
  type AimbraceError,
  AppStateError,
  ConfigError,
  DisposalError,
  PluginError,
  StartupValidationError,
} from './errors'
import { buildGraph, type Graph } from './graph'
import type { Hooks } from './hooks'
import { trackedCallbacks } from './internal/cordis'
import { type AppState, type ErrorReporter, Kernel } from './internal/kernel'
import { RootLifetime } from './lifetime'
import { type PluginLike, type PluginRecord, resolvePluginLike } from './plugin'
import { installer, installRuntime, resolveConfig } from './plugin-runtime'
import type { Registry, RegistryToken } from './registry'
import type { ServiceToken } from './service'

export type { AppState } from './internal/kernel'

/** Options for {@link createApp}. */
export interface AppOptions {
  /** Shown in snapshots and hook payloads. Defaults to `app`. */
  name?: string
  /** Plugins to register. More can be added with `app.use` before `start`. */
  plugins?: readonly PluginLike[]
  /**
   * Receives errors that cannot be thrown to a caller: failing observers,
   * rollback failures, plugins that fail when they reactivate. Defaults to `console.error`.
   */
  onError?: ErrorReporter
}

/** One plugin in {@link AppSnapshot}. */
export interface PluginSnapshot {
  /** Unique path: the id, or `parent/id` for a nested plugin. */
  key: string
  id: string
  version: string | undefined
  state: PluginState
  parent: string | undefined
  provides: string[]
  error: string | undefined
}

/** One scope in {@link AppSnapshot}. */
export interface ScopeSnapshot {
  id: string
  name: string
  parent: string | undefined
}

/** The observed runtime tree of an app. */
export interface AppSnapshot {
  name: string
  state: AppState
  /** In installation order, parents before children. */
  plugins: PluginSnapshot[]
  scopes: ScopeSnapshot[]
  /** Every live service provision and the plugin that provides it. */
  services: Array<{ service: string; provider: string }>
  /** Registry name -> number of entries. */
  registries: Record<string, number>
  hooks: number
}

/** Live counts of everything an app can leak. All zero after `stop()`. */
export interface LeakProbe {
  plugins: number
  scopes: number
  services: number
  hooks: number
  registryEntries: number
  registrySubscribers: number
  /** Plugin and scope callbacks Cordis still tracks. */
  fibers: number
  /** True when every count is zero. */
  clean: boolean
}

/** The composition root. */
export interface App extends AsyncDisposable {
  readonly name: string
  readonly state: AppState
  /** Typed hooks: lifecycle events and anything plugins declare. */
  readonly hooks: Hooks<AppHooks>
  /** Aborted when the app begins stopping. */
  readonly signal: AbortSignal
  /** Register plugins before `start`. Chainable. */
  use(...plugins: PluginLike[]): this
  /** Validate, install in dependency order, then start. Rolls back on failure. */
  start(): Promise<void>
  /** Stop in reverse order and release everything. Safe to call more than once. */
  stop(): Promise<void>
  /** Install a plugin into the running app. */
  install(plugin: PluginLike, config?: unknown, options?: InstallOptions): Promise<PluginHandle>
  /** Read a service. Throws when absent. */
  get<T>(token: ServiceToken<T>): T
  /** Read a service or `undefined`. */
  maybe<T>(token: ServiceToken<T>): T | undefined
  /** A registry view owned by the app. */
  registry<T>(token: RegistryToken<T>): Registry<T>
  /** Open a scope (a task, a request) under the app. */
  scope(name: string, options?: ScopeOptions): Promise<Scope>
  /** The static dependency graph of the registered plugins. */
  graph(): Graph
  /** The observed runtime tree. */
  inspect(): AppSnapshot
  /** Leak counters. */
  probe(): LeakProbe
}

interface Registered {
  plugin: PluginRecord
  config: unknown
}

class AppImpl implements App {
  readonly name: string
  readonly hooks: Hooks<AppHooks>
  readonly #kernel: Kernel
  readonly #root: RootLifetime
  readonly #registered: Registered[] = []
  #graph: Graph | undefined
  #stopping: Promise<void> | undefined

  constructor(options: AppOptions) {
    this.name = options.name ?? 'app'
    this.#kernel = new Kernel(options.onError ? { onError: options.onError } : {})
    this.#kernel.installer = installer
    this.#root = new RootLifetime(this.#kernel, this.name)
    this.hooks = this.#kernel.hooks
    for (const plugin of options.plugins ?? []) this.#add(plugin)
  }

  get state(): AppState {
    return this.#kernel.state
  }

  get signal(): AbortSignal {
    return this.#root.signal
  }

  use(...plugins: PluginLike[]): this {
    this.#assertState(
      ['created'],
      'use() only works before start(); use install() on a running app',
    )
    for (const plugin of plugins) this.#add(plugin)
    return this
  }

  #add(like: PluginLike): void {
    const { plugin, config } = resolvePluginLike(like)
    this.#registered.push({ plugin, config })
  }

  async start(): Promise<void> {
    this.#assertState(['created'], 'start() was already called')
    this.#kernel.state = 'starting'
    try {
      const graph = buildGraph(this.#registered.map((entry) => entry.plugin.meta))
      this.#graph = graph
      const errors: AimbraceError[] = [...graph.errors]
      const configs: unknown[] = []
      for (const entry of this.#registered) {
        try {
          configs.push(await resolveConfig(entry.plugin, entry.config))
        } catch (error) {
          if (error instanceof ConfigError || error instanceof PluginError) errors.push(error)
          else throw error
        }
      }
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new StartupValidationError(errors)

      await this.hooks.callHook('graph:built', graph)
      await this.hooks.callHook('app:starting')
      const byId = new Map(this.#registered.map((entry, index) => [entry.plugin.id, index]))
      for (const id of graph.order) {
        const index = byId.get(id) as number
        const entry = this.#registered[index] as Registered
        await installRuntime(this.#root, entry.plugin, configs[index], { startNow: false })
      }
      for (const runtime of [...this.#kernel.installOrder]) {
        if (runtime.canStart()) await runtime.start()
      }
      this.#kernel.state = 'running'
      await this.hooks.callHook('app:ready')
    } catch (error) {
      this.#kernel.state = 'failed'
      for (const rollback of await this.#teardown())
        this.#kernel.report(rollback, 'rollback after failed start')
      this.hooks.clear()
      throw error
    }
  }

  stop(): Promise<void> {
    this.#stopping ??= this.#stop()
    return this.#stopping
  }

  async #stop(): Promise<void> {
    const state = this.#kernel.state
    if (state === 'stopped') return
    if (state === 'starting') {
      throw new AppStateError(state, 'stop() cannot run while start() is in progress')
    }
    const errors: unknown[] = []
    if (state === 'failed') {
      // start() already rolled everything back
      this.#kernel.state = 'stopped'
      return
    }
    if (state === 'running') {
      this.#kernel.state = 'stopping'
      // Tell in-flight work to wind down before anything else happens.
      this.#root.abort()
      try {
        await this.hooks.callHook('app:stopping')
      } catch (error) {
        errors.push(error)
      }
    }
    errors.push(...(await this.#teardown()))
    if (state === 'running') {
      try {
        await this.hooks.callHook('app:stopped')
      } catch (error) {
        errors.push(error)
      }
    }
    this.hooks.clear()
    this.#kernel.state = 'stopped'
    if (errors.length > 0) throw new DisposalError(errors)
  }

  /** Release the app's own lifetime, then stop and dispose every plugin in reverse installation order. */
  async #teardown(): Promise<unknown[]> {
    const errors: unknown[] = []
    const attempt = async (fn: () => Promise<unknown>) => {
      try {
        await fn()
      } catch (error) {
        errors.push(error)
      }
    }
    await attempt(() => this.#root.end())
    const runtimes = [...this.#kernel.installOrder].reverse()
    for (const runtime of runtimes) await attempt(() => runtime.stop())
    for (const runtime of runtimes) await attempt(() => runtime.dispose())
    return errors
  }

  async install(
    plugin: PluginLike,
    config?: unknown,
    options?: InstallOptions,
  ): Promise<PluginHandle> {
    this.#assertState(['running'], 'install() needs a running app')
    return this.#root.install(plugin, config, options)
  }

  get<T>(token: ServiceToken<T>): T {
    return this.#kernel.service(token)
  }

  maybe<T>(token: ServiceToken<T>): T | undefined {
    return this.#kernel.maybeService(token)
  }

  registry<T>(token: RegistryToken<T>): Registry<T> {
    return this.#root.registry(token)
  }

  async scope(name: string, options?: ScopeOptions): Promise<Scope> {
    this.#assertState(['running'], 'scope() needs a running app')
    return this.#root.scope(name, options)
  }

  graph(): Graph {
    if (this.#kernel.state === 'created') {
      return buildGraph(this.#registered.map((entry) => entry.plugin.meta))
    }
    return this.#graph ?? buildGraph(this.#registered.map((entry) => entry.plugin.meta))
  }

  inspect(): AppSnapshot {
    const kernel = this.#kernel
    return {
      name: this.name,
      state: kernel.state,
      plugins: kernel.installOrder.map((runtime) => ({
        key: runtime.key,
        id: runtime.id,
        version: runtime.record.version,
        state: runtime.state(),
        parent: runtime.parent?.key,
        provides: [...(runtime.activation?.provided ?? [])],
        error: runtime.error?.message,
      })),
      scopes: [...kernel.scopes].map((scope) => ({
        id: scope.id,
        name: scope.name,
        parent: scope.parent?.name,
      })),
      services: [...kernel.providers.values()].map((entry) => ({ ...entry })),
      registries: kernel.registries.sizes(),
      hooks: kernel.hooks.count(),
    }
  }

  probe(): LeakProbe {
    const kernel = this.#kernel
    const counts = {
      plugins: kernel.runtimes.size,
      scopes: kernel.scopes.size,
      services: kernel.providers.size,
      hooks: kernel.hooks.count(),
      registryEntries: kernel.registries.total(),
      registrySubscribers: kernel.registries.subscribers(),
      fibers: trackedCallbacks(kernel.root),
    }
    return { ...counts, clean: Object.values(counts).every((count) => count === 0) }
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.stop()
  }

  #assertState(allowed: AppState[], message: string): void {
    if (!allowed.includes(this.#kernel.state)) throw new AppStateError(this.#kernel.state, message)
  }
}

/**
 * Create an app: the composition root that owns a Cordis context, the typed
 * hook map and every registry. An app is single-use.
 *
 * @example
 * const app = createApp({ plugins: [config, database, agent] })
 * await app.start()
 * const runtime = app.get(AgentRuntime)
 * await app.stop()
 */
export function createApp(options: AppOptions = {}): App {
  return new AppImpl(options)
}
