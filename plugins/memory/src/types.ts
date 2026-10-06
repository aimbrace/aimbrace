/** One remembered fact. */
export interface MemoryEntry {
  readonly id: string
  readonly namespace: string
  readonly text: string
  /** Milliseconds since the epoch. */
  readonly at: number
  readonly tags: readonly string[]
}

/** A place to remember things. */
export interface MemoryService {
  /** Remember `text` under a namespace. Evicts the oldest entry of the store when it is full. */
  remember(namespace: string, text: string, tags?: readonly string[]): MemoryEntry
  /**
   * Entries of a namespace, best match first when `query` is given (every word counts once),
   * newest first otherwise.
   */
  recall(namespace: string, query?: string, limit?: number): MemoryEntry[]
  /** Forget a namespace. Returns how many entries went. */
  clear(namespace: string): number
  /** Number of entries in all namespaces. */
  size(): number
}
