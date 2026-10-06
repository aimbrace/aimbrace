import type { InstallOptions, PluginHandle } from '../context'
import type { AppHooks } from '../core-hooks'
import { MissingServiceError } from '../errors'
import { type HookName, Hooks } from '../hooks'
import type { Lifetime } from '../lifetime'
import type { PluginLike } from '../plugin'
import type { PluginRuntime } from '../plugin-runtime'
import { RegistryStore } from '../registry'
import type { ServiceToken } from '../service'
import { type CordisContext, createRoot, lookup, serviceKey } from './cordis'

/** Lifecycle state of an app. */
export type AppState = 'created' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'

/** Receives errors that cannot be thrown to a caller (observers, background teardown). */
export type ErrorReporter = (error: unknown, where: string) => void

/** One live service provision. */
export interface ProviderEntry {
  readonly service: string
  /** Key of the plugin runtime providing it. */
  readonly provider: string
}

/** What the kernel needs to know about a live scope. */
export interface ScopeRef {
  readonly id: string
  readonly name: string
  readonly parent: Lifetime | undefined
}

/** Installs plugins at runtime. Injected by `app.ts` so lifetime and runtime modules do not import each other. */
export interface Installer {
  install(
    parent: Lifetime,
    plugin: PluginLike,
    config: unknown,
    options: InstallOptions | undefined,
  ): Promise<PluginHandle>
}

/** State shared by everything inside one app. Never shared between apps. */
export class Kernel {
  readonly root: CordisContext = createRoot()
  readonly hooks = new Hooks<AppHooks>()
  readonly registries: RegistryStore
  /** Every live plugin runtime, root, dynamic and nested. */
  readonly runtimes = new Set<PluginRuntime>()
  /** Runtimes in installation order, parent before child. Start goes forward, teardown backward. */
  readonly installOrder: PluginRuntime[] = []
  readonly scopes = new Set<ScopeRef>()
  /** Every service some plugin provides right now, one entry per provider (isolated copies are separate entries). */
  readonly providers = new Map<string, ProviderEntry>()
  readonly report: ErrorReporter
  state: AppState = 'created'
  installer!: Installer
  #counter = 0

  constructor(options: { onError?: ErrorReporter } = {}) {
    this.report =
      options.onError ??
      ((error, where) => {
        console.error(`[aimbrace] ${where}:`, error)
      })
    this.registries = new RegistryStore({
      onChange: (event) => this.emit('registry:change', event),
      onListenerError: (error) => this.report(error, 'registry subscriber'),
    })
  }

  nextId(prefix: string): string {
    this.#counter += 1
    return `${prefix}:${this.#counter}`
  }

  /** Fire a hook without waiting. Errors go to the reporter. For observers on synchronous paths. */
  emit<K extends HookName<AppHooks>>(name: K, ...args: Parameters<AppHooks[K]>): void {
    if (this.hooks.count(name) === 0 && !this.hooks.observed()) return
    this.hooks.callHook(name, ...args).catch((error: unknown) => this.report(error, `hook ${name}`))
  }

  maybeService<T>(token: ServiceToken<T>, from: CordisContext = this.root): T | undefined {
    return lookup(from, serviceKey(token.name)) as T | undefined
  }

  service<T>(token: ServiceToken<T>, from: CordisContext = this.root): T {
    const value = this.maybeService(token, from)
    if (value === undefined) throw new MissingServiceError(token.name)
    return value
  }
}
