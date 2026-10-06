import { Hookable } from 'hookable'
import type { Owner } from './disposable'

// biome-ignore lint/suspicious/noExplicitAny: hook argument lists are generic by nature
type AnyArgs = any[]

/** Shape constraint for a hook map: every member is a function. Interfaces satisfy it. */
export type HookShape<T> = { [K in keyof T]: (...args: AnyArgs) => void | Promise<void> }

/** Names of the hooks in a map. */
export type HookName<T> = keyof T & string

/** Function to remove a registration. Safe to call more than once. */
export type Unhook = () => void

/** Event passed to {@link Hooks.beforeEach} and {@link Hooks.afterEach} listeners. */
export interface HookEvent<T extends HookShape<T>> {
  name: HookName<T>
  args: AnyArgs
  context: Record<string, unknown>
}

/**
 * A typed hook map.
 *
 * A thin layer over UnJS `hookable`: same serial and parallel dispatch, but
 * `callHook` always returns a promise, and live registrations are counted so
 * tests can prove nothing leaks.
 *
 * @example
 * interface AgentHooks { 'agent:start': (run: { id: string }) => void }
 * const hooks = new Hooks<AgentHooks>()
 * const off = hooks.hook('agent:start', (run) => console.log(run.id))
 * await hooks.callHook('agent:start', { id: '42' })
 * off()
 */
export class Hooks<T extends HookShape<T>> {
  readonly #hookable = new Hookable<T>()
  readonly #counts = new Map<string, number>()

  /** Register `fn` for `name`. Returns the function that removes it. */
  hook<K extends HookName<T>>(name: K, fn: T[K]): Unhook {
    const remove = this.#hookable.hook(name, fn as never)
    this.#counts.set(name, (this.#counts.get(name) ?? 0) + 1)
    let active = true
    return () => {
      if (!active) return
      active = false
      remove()
      const next = (this.#counts.get(name) ?? 1) - 1
      if (next <= 0) this.#counts.delete(name)
      else this.#counts.set(name, next)
    }
  }

  /** Register `fn` so that it runs at most once. */
  hookOnce<K extends HookName<T>>(name: K, fn: T[K]): Unhook {
    const off: Unhook = this.hook(name, ((...args: AnyArgs) => {
      off()
      return (fn as (...a: AnyArgs) => void | Promise<void>)(...args)
    }) as T[K])
    return off
  }

  /** Run the hooks for `name` one after another, in registration order. */
  async callHook<K extends HookName<T>>(name: K, ...args: Parameters<T[K]>): Promise<void> {
    await this.#hookable.callHook(name, ...(args as never))
  }

  /** Start all hooks for `name` together and wait for all of them. */
  async callHookParallel<K extends HookName<T>>(name: K, ...args: Parameters<T[K]>): Promise<void> {
    await this.#hookable.callHookParallel(name, ...(args as never))
  }

  /** Observe every call before it reaches the hooks (tracing, debugging). */
  beforeEach(listener: (event: HookEvent<T>) => void): Unhook {
    return this.#hookable.beforeEach(listener as never)
  }

  /** Observe every call after its hooks finished. */
  afterEach(listener: (event: HookEvent<T>) => void): Unhook {
    return this.#hookable.afterEach(listener as never)
  }

  /**
   * Number of live registrations: for one hook name, or in total.
   * This is the leak probe.
   */
  count(name?: HookName<T>): number {
    if (name !== undefined) return this.#counts.get(name) ?? 0
    let total = 0
    for (const value of this.#counts.values()) total += value
    return total
  }

  /** Names that currently have at least one registration. */
  names(): string[] {
    return [...this.#counts.keys()]
  }

  /** Remove every registration. */
  clear(): void {
    this.#hookable.removeAllHooks()
    this.#counts.clear()
  }

  /** A view whose registrations are removed when `owner` ends. */
  scoped(owner: Owner): ScopedHooks<T> {
    return new ScopedHooks(this, owner)
  }
}

/** A {@link Hooks} view bound to an {@link Owner}: registrations vanish with the owner. */
export class ScopedHooks<T extends HookShape<T>> {
  readonly #hooks: Hooks<T>
  readonly #owner: Owner

  constructor(hooks: Hooks<T>, owner: Owner) {
    this.#hooks = hooks
    this.#owner = owner
  }

  hook<K extends HookName<T>>(name: K, fn: T[K]): Unhook {
    return this.#bind(this.#hooks.hook(name, fn))
  }

  hookOnce<K extends HookName<T>>(name: K, fn: T[K]): Unhook {
    return this.#bind(this.#hooks.hookOnce(name, fn))
  }

  callHook<K extends HookName<T>>(name: K, ...args: Parameters<T[K]>): Promise<void> {
    return this.#hooks.callHook(name, ...args)
  }

  callHookParallel<K extends HookName<T>>(name: K, ...args: Parameters<T[K]>): Promise<void> {
    return this.#hooks.callHookParallel(name, ...args)
  }

  #bind(off: Unhook): Unhook {
    const disown = this.#owner.own(off)
    return () => {
      disown()
      off()
    }
  }
}
