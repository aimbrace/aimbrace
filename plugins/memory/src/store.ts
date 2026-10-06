import type { MemoryEntry, MemoryService } from './types'

/** Options of {@link createMemoryStore}. */
export interface MemoryStoreOptions {
  /** Most entries kept in total; the oldest go first. Default 1000. */
  maxEntries?: number
  /** Called after every write. */
  onWrite?: (entry: MemoryEntry) => void
  now?: () => number
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/** A simple in-process store: keyword recall, bounded size. */
export function createMemoryStore(options: MemoryStoreOptions = {}): MemoryService {
  const maxEntries = options.maxEntries ?? 1000
  const now = options.now ?? (() => Date.now())
  let entries: MemoryEntry[] = []
  let counter = 0
  return {
    remember(namespace, text, tags = []) {
      const entry: MemoryEntry = {
        id: `m${++counter}`,
        namespace,
        text,
        at: now(),
        tags: [...tags],
      }
      entries.push(entry)
      if (entries.length > maxEntries) entries = entries.slice(entries.length - maxEntries)
      options.onWrite?.(entry)
      return entry
    },
    recall(namespace, query, limit = 5) {
      const inNamespace = entries.filter((entry) => entry.namespace === namespace)
      const wanted = query ? [...new Set(words(query))] : []
      if (wanted.length === 0) return inNamespace.slice().reverse().slice(0, limit)
      return inNamespace
        .map((entry, index) => {
          const have = new Set([...words(entry.text), ...entry.tags.flatMap(words)])
          return { entry, index, score: wanted.filter((word) => have.has(word)).length }
        })
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score || b.index - a.index)
        .slice(0, limit)
        .map((match) => match.entry)
    },
    clear(namespace) {
      const before = entries.length
      entries = entries.filter((entry) => entry.namespace !== namespace)
      return before - entries.length
    },
    size: () => entries.length,
  }
}

/** A store for one task: same interface, one fixed namespace. Provide it in a scope so it dies with the task. */
export function createTaskMemory(namespace = 'task'): MemoryService {
  const store = createMemoryStore({ maxEntries: 200 })
  return {
    remember: (_ns, text, tags) => store.remember(namespace, text, tags),
    recall: (_ns, query, limit) => store.recall(namespace, query, limit),
    clear: () => store.clear(namespace),
    size: () => store.size(),
  }
}
