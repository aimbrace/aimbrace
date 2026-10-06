import type { AppHooks, PluginState } from './core-hooks'
import type { Owner } from './disposable'
import type { ScopedHooks } from './hooks'
import type { PluginLike, ServiceList } from './plugin'
import type { Registry, RegistryToken } from './registry'
import type { ServiceToken, ValueOf } from './service'

/** What every context offers, whatever its lifetime: app, plugin or scope. */
export interface BaseContext extends Owner {
  /** Human readable name, for example `plugin:agent` or `task:42`. */
  readonly name: string
  /** Aborted when this context ends. */
  readonly signal: AbortSignal
  /** Hook registrations made here are removed when this context ends. */
  readonly hooks: ScopedHooks<AppHooks>
  /**
   * Report an error that cannot be thrown to a caller (a background task, a
   * failing observer). It goes to the app's `onError`.
   */
  report(error: unknown, where?: string): void
  /** A view of a registry. Entries added here are removed when this context ends. */
  registry<T>(token: RegistryToken<T>): Registry<T>
  /** Open a child scope. Disposing the parent disposes the child first. */
  scope(name: string, options?: ScopeOptions): Promise<Scope>
  /**
   * Install a plugin at runtime, tied to this context's lifetime. Returns a
   * handle to remove it early.
   */
  install(plugin: PluginLike, config?: unknown, options?: InstallOptions): Promise<PluginHandle>
}

/** Options for installing a plugin at runtime. */
export interface InstallOptions {
  /**
   * Services that become private to the installed subtree (plugin-graph
   * encapsulation, built on Cordis `isolate`): the installed plugins provide and
   * consume their own copy, invisible outside. Requirements on these services
   * are resolved dynamically (the plugin stays `pending` until provided).
   */
  isolate?: readonly ServiceToken<unknown>[]
}

/** Options for opening a scope. */
export interface ScopeOptions {
  /** An outside signal. When it aborts, the scope is disposed. */
  signal?: AbortSignal
}

/**
 * A temporal context: a child of the app (or of another scope) with its own
 * services, abort signal and resources. Disposing it releases all of them.
 */
export interface Scope extends BaseContext, AsyncDisposable {
  readonly id: string
  readonly disposed: boolean
  /** Read a service visible from here. Throws when absent. */
  get<T>(token: ServiceToken<T>): T
  /** Read a service visible from here, or `undefined`. */
  maybe<T>(token: ServiceToken<T>): T | undefined
  /** Provide a service for the lifetime of this scope. Returns a function that removes it early. */
  provide<T>(token: ServiceToken<T>, value: T): () => void
  /** Run `fn` and dispose the scope afterwards, also when `fn` throws. */
  run<T>(fn: (scope: Scope) => T | Promise<T>): Promise<T>
  dispose(): Promise<void>
}

/**
 * The context handed to a plugin's `setup`, `start` and `stop`. Its `get`,
 * `maybe` and `provide` are limited, at the type level, to what the plugin
 * declared. Everything it acquires is released when the plugin is disposed.
 */
export interface PluginContext<
  R extends ServiceList = ServiceList,
  O extends ServiceList = ServiceList,
  P extends ServiceList = ServiceList,
> extends BaseContext {
  readonly pluginId: string
  /** Read a declared requirement. */
  get<S extends R[number]>(token: S): ValueOf<S>
  /** Read a declared optional dependency, or `undefined` when no plugin provides it. */
  maybe<S extends O[number]>(token: S): ValueOf<S> | undefined
  /** Provide a declared service. Must be called once for every entry of `provides`. */
  provide<S extends P[number]>(token: S, value: ValueOf<S>): void
}

/** Returned by `use`. */
export interface PluginHandle {
  readonly id: string
  readonly state: PluginState
  /** Stop and remove the plugin. */
  dispose(): Promise<void>
}
