import { definePlugin, service } from '@aimbrace/core'
import * as v from 'valibot'
import { createMemoryStore } from './store'
import type { MemoryEntry, MemoryService } from './types'

/** Long-term memory. */
export const Memory = service<MemoryService>('ai.memory', { description: 'Long-term memory' })

/** Memory that lives in one task scope. Provided by the agent for the duration of a run. */
export const TaskMemory = service<MemoryService>('ai.task-memory', {
  description: 'Memory of the current task',
})

declare module '@aimbrace/core' {
  interface HookExtensions {
    'memory:write': (entry: MemoryEntry) => void | Promise<void>
  }
}

const Shape = v.object({
  maxEntries: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1000),
})
const Config = v.optional(Shape, v.getDefaults(Shape))

/** Provides long-term {@link Memory}: an in-process store with keyword recall and a size bound. */
export const memory = definePlugin({
  id: 'memory',
  version: '0.1.0',
  description: 'In-process long-term memory',
  provides: [Memory],
  config: Config,
  setup(ctx, config) {
    ctx.provide(
      Memory,
      createMemoryStore({
        maxEntries: config.maxEntries,
        onWrite: (entry) => {
          ctx.hooks
            .callHook('memory:write', entry)
            .catch((error: unknown) => ctx.report(error, 'memory:write hook'))
        },
      }),
    )
  },
})

export default memory
