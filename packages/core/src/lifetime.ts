import type { BaseContext, InstallOptions, PluginHandle, Scope, ScopeOptions } from './context'
import type { AppHooks, ScopeInfo } from './core-hooks'
import { type Disposer, DisposerStack } from './disposable'
import {
  DisposalError,
  DisposedError,
  DuplicateProvideError,
  InvalidServiceValueError,
  MissingServiceError,
} from './errors'
import type { ScopedHooks } from './hooks'
import { type CordisContext, type CordisFiber, spawnScope } from './internal/cordis'
import type { Kernel } from './internal/kernel'
import type { PluginLike } from './plugin'
import type { Registry, RegistryToken } from './registry'
import type { ServiceToken } from './service'

/**
 * A thing with a lifetime: the app, a plugin activation, or a scope. It owns a
 * LIFO stack of resources, an abort signal, hook registrations and registry
 * views. Ending it aborts the signal and releases everything newest first.
 */
export abstract class Lifetime implements BaseContext {
  readonly name: string
  readonly kernel: Kernel
  /** The Cordis context this lifetime lives in. */
  readonly cctx: CordisContext
  readonly parent: Lifetime | undefined
  readonly stack = new DisposerStack()
  readonly hooks: ScopedHooks<AppHooks>
  readonly #abort = new AbortController()
  #ended: Promise<void> | undefined

  constructor(kernel: Kernel, name: string, cctx: CordisContext, parent?: Lifetime) {
    this.kernel = kernel
    this.name = name
    this.cctx = cctx
    this.parent = parent
    this.hooks = kernel.hooks.scoped(this.stack)
  }

  get signal(): AbortSignal {
    return this.#abort.signal
  }

  /** True once ending has started. */
  get ended(): boolean {
    return this.#ended !== undefined
  }

  own(disposer: Disposer): () => void {
    return this.stack.own(disposer)
  }

  registry<T>(token: RegistryToken<T>): Registry<T> {
    return this.kernel.registries.view(token, this.stack)
  }

  scope(name: string, options?: ScopeOptions): Promise<Scope> {
    return ScopeImpl.open(this, name, options)
  }

  install(plugin: PluginLike, config?: unknown, options?: InstallOptions): Promise<PluginHandle> {
    if (this.ended) return Promise.reject(new DisposedError(`context "${this.name}"`))
    return this.kernel.installer.install(this, plugin, config, options)
  }

  /** Scope-local value lookup. Only scopes have local values. */
  lookupLocal(_name: string): unknown {
    return undefined
  }

  /** Abort the signal now, without releasing anything yet. Idempotent. */
  abort(): void {
    this.#abort.abort()
  }

  /** Abort the signal and release every resource, newest first. Idempotent. */
  end(): Promise<void> {
    this.#ended ??= (async () => {
      this.abort()
      await this.stack.dispose()
    })()
    return this.#ended
  }
}

/** The app's own lifetime: parent of app-level scopes, registry views and dynamic plugins. */
export class RootLifetime extends Lifetime {
  constructor(kernel: Kernel, name: string) {
    super(kernel, name, kernel.root)
  }
}

/**
 * A scope: a child fiber with its own signal, local services and resources.
 * See `specs/003-app-lifecycle/research` (R7) for why local services are a
 * plain chain rather than Cordis services.
 */
export class ScopeImpl extends Lifetime implements Scope {
  readonly id: string
  readonly #local = new Map<string, unknown>()
  readonly #fiber: CordisFiber
  #forget: () => void = () => {}
  #disposing: Promise<void> | undefined

  private constructor(
    kernel: Kernel,
    id: string,
    name: string,
    cctx: CordisContext,
    fiber: CordisFiber,
    parent: Lifetime,
  ) {
    super(kernel, name, cctx, parent)
    this.id = id
    this.#fiber = fiber
  }

  static async open(
    parent: Lifetime,
    name: string,
    options: ScopeOptions = {},
  ): Promise<ScopeImpl> {
    options.signal?.throwIfAborted()
    if (parent.ended) throw new DisposedError(`context "${parent.name}"`)
    const kernel = parent.kernel
    const id = kernel.nextId('scope')
    const { ctx, fiber } = await spawnScope(parent.cctx, `scope:${name}`)
    const scope = new ScopeImpl(kernel, id, name, ctx, fiber, parent)
    try {
      scope.#forget = parent.own(() => scope.dispose())
    } catch (error) {
      await fiber.dispose()
      throw error
    }
    kernel.scopes.add(scope)
    kernel.emit('scope:open', scope.#info())
    if (options.signal) {
      const external = options.signal
      const onAbort = () => {
        scope.dispose().catch((error: unknown) => kernel.report(error, `scope ${name}`))
      }
      if (external.aborted) onAbort()
      else {
        external.addEventListener('abort', onAbort, { once: true })
        scope.own(() => external.removeEventListener('abort', onAbort))
      }
    }
    return scope
  }

  get disposed(): boolean {
    return this.ended
  }

  override lookupLocal(name: string): unknown {
    if (this.#local.has(name)) return this.#local.get(name)
    return this.parent?.lookupLocal(name)
  }

  maybe<T>(token: ServiceToken<T>): T | undefined {
    const local = this.lookupLocal(token.name) as T | undefined
    return local ?? this.kernel.maybeService(token, this.cctx)
  }

  get<T>(token: ServiceToken<T>): T {
    const value = this.maybe(token)
    if (value === undefined) throw new MissingServiceError(token.name)
    return value
  }

  provide<T>(token: ServiceToken<T>, value: T): () => void {
    if (this.ended) throw new DisposedError(`scope "${this.name}"`)
    if (value === undefined || value === null) throw new InvalidServiceValueError(token.name)
    if (this.#local.has(token.name)) {
      throw new DuplicateProvideError(token.name, `scope "${this.name}"`)
    }
    this.#local.set(token.name, value)
    return () => {
      if (this.#local.get(token.name) === value) this.#local.delete(token.name)
    }
  }

  async run<T>(fn: (scope: Scope) => T | Promise<T>): Promise<T> {
    let result: T
    try {
      result = await fn(this)
    } catch (error) {
      await this.dispose().catch((failure: unknown) =>
        this.kernel.report(failure, `scope ${this.name}`),
      )
      throw error
    }
    await this.dispose()
    return result
  }

  dispose(): Promise<void> {
    this.#disposing ??= (async () => {
      const errors: unknown[] = []
      try {
        await this.end()
      } catch (error) {
        errors.push(error)
      }
      try {
        await this.#fiber.dispose()
      } catch (error) {
        errors.push(error)
      }
      this.#local.clear()
      this.#forget()
      this.kernel.scopes.delete(this)
      this.kernel.emit('scope:close', this.#info())
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new DisposalError(errors)
    })()
    return this.#disposing
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose()
  }

  #info(): ScopeInfo {
    return { id: this.id, name: this.name, parent: this.parent?.name }
  }
}
