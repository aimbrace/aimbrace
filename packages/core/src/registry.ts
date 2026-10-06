import type { Owner } from './disposable'
import { DuplicateRegistryEntryError } from './errors'
import { assertName } from './internal/name'

declare const itemType: unique symbol

/**
 * A typed handle for a registry: a collection many plugins contribute to and
 * many plugins read, without knowing about each other.
 */
export interface RegistryToken<T = unknown> {
  readonly kind: 'registry'
  readonly name: string
  readonly description: string | undefined
  /** Optional identity function. Enables `get(id)` and duplicate detection. */
  readonly key: ((item: T) => string) | undefined
  /** Phantom property that carries `T`. Never present at runtime. */
  readonly [itemType]?: T
}

/** Extract the item type of a registry token. */
export type ItemOf<R> = R extends RegistryToken<infer T> ? T : never

/** Options for {@link registry}. */
export interface RegistryOptions<T> {
  description?: string
  /** Derive a unique id from an item. Duplicates then throw. */
  key?: (item: T) => string
}

/**
 * Create a typed registry token.
 *
 * @example
 * const Tools = registry<Tool>('tools', { key: (tool) => tool.name })
 */
export function registry<T>(name: string, options: RegistryOptions<T> = {}): RegistryToken<T> {
  assertName('registry', name)
  return Object.freeze({
    kind: 'registry' as const,
    name,
    description: options.description,
    key: options.key,
  })
}

/** True when `value` is a registry token. */
export function isRegistryToken(value: unknown): value is RegistryToken {
  return (
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'registry'
  )
}

/** A change to a registry. */
export interface RegistryEvent<T = unknown> {
  type: 'add' | 'remove'
  registry: string
  item: T
  id: string | undefined
}

/** The reading and writing surface of one registry. */
export interface Registry<T> extends Iterable<T> {
  readonly name: string
  readonly size: number
  /** Add an item. Returns a function that removes exactly this entry. */
  add(item: T): () => void
  /** A snapshot of the items in insertion order. */
  all(): readonly T[]
  /** Look an item up by id (needs a `key` on the token). */
  get(id: string): T | undefined
  has(id: string): boolean
  /** Be told about additions and removals. Returns the unsubscribe function. */
  subscribe(listener: (event: RegistryEvent<T>) => void): () => void
}

interface Entry {
  id: string | undefined
  item: unknown
}

/** Options for {@link RegistryStore}. */
export interface RegistryStoreOptions {
  /** Called for every change in any registry (the app uses it to feed typed hooks). */
  onChange?: (event: RegistryEvent) => void
  /** Called when a subscriber throws. Defaults to `console.error`. */
  onListenerError?: (error: unknown) => void
}

type Listener = (event: RegistryEvent) => void

/**
 * Holds the entries of every registry in one app. Collections are keyed by
 * token name. Use {@link RegistryStore.view} to read and write them.
 */
export class RegistryStore {
  readonly #entries = new Map<string, Entry[]>()
  readonly #listeners = new Map<string, Set<Listener>>()
  readonly #options: RegistryStoreOptions

  constructor(options: RegistryStoreOptions = {}) {
    this.#options = options
  }

  /**
   * A view of one registry. Entries and subscriptions made through a view that
   * has an `owner` are released when the owner ends.
   */
  view<T>(token: RegistryToken<T>, owner?: Owner): Registry<T> {
    const store = this
    const name = token.name
    const entries = (): Entry[] => store.#entries.get(name) ?? []
    return {
      name,
      get size() {
        return entries().length
      },
      add(item) {
        const id = token.key?.(item)
        if (id !== undefined && entries().some((entry) => entry.id === id)) {
          throw new DuplicateRegistryEntryError(name, id)
        }
        const entry: Entry = { id, item }
        let live = true
        const remove = () => {
          if (!live) return
          live = false
          store.#remove(name, entry)
        }
        // Take ownership first: if the owner has already ended this throws and nothing is published.
        const disown = owner?.own(remove)
        const list = store.#entries.get(name) ?? []
        list.push(entry)
        store.#entries.set(name, list)
        store.#emit({ type: 'add', registry: name, item, id })
        return () => {
          disown?.()
          remove()
        }
      },
      all: () => Object.freeze(entries().map((entry) => entry.item as T)),
      get: (id) => entries().find((entry) => entry.id === id)?.item as T | undefined,
      has: (id) => entries().some((entry) => entry.id === id),
      subscribe(listener) {
        const set = store.#listeners.get(name) ?? new Set<Listener>()
        store.#listeners.set(name, set)
        set.add(listener as Listener)
        const unsubscribe = () => {
          set.delete(listener as Listener)
          if (set.size === 0) store.#listeners.delete(name)
        }
        const disown = owner?.own(unsubscribe)
        return () => {
          disown?.()
          unsubscribe()
        }
      },
      [Symbol.iterator]() {
        return entries()
          .map((entry) => entry.item as T)
          [Symbol.iterator]()
      },
    }
  }

  /** Total number of entries across all registries. The leak probe. */
  total(): number {
    let total = 0
    for (const list of this.#entries.values()) total += list.length
    return total
  }

  /** Number of entries per registry that currently has any. */
  sizes(): Record<string, number> {
    const sizes: Record<string, number> = {}
    for (const [name, list] of this.#entries) if (list.length > 0) sizes[name] = list.length
    return sizes
  }

  /** Number of live subscribers across all registries. */
  subscribers(): number {
    let total = 0
    for (const set of this.#listeners.values()) total += set.size
    return total
  }

  #remove(name: string, entry: Entry): void {
    const list = this.#entries.get(name)
    if (!list) return
    const index = list.indexOf(entry)
    if (index === -1) return
    list.splice(index, 1)
    if (list.length === 0) this.#entries.delete(name)
    this.#emit({ type: 'remove', registry: name, item: entry.item, id: entry.id })
  }

  #emit(event: RegistryEvent): void {
    const report = this.#options.onListenerError ?? ((error: unknown) => console.error(error))
    try {
      this.#options.onChange?.(event)
    } catch (error) {
      report(error)
    }
    for (const listener of [...(this.#listeners.get(event.registry) ?? [])]) {
      try {
        listener(event)
      } catch (error) {
        report(error)
      }
    }
  }
}
