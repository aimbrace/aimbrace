import { registry, service } from '@aimbrace/core'
import type { Tool, ToolRunnerService } from './types'

/** Tools contributed by plugins. They disappear when their plugin does. */
export const Tools = registry<Tool>('ai.tools', {
  description: 'Tools agents can call',
  key: (tool) => tool.name,
})

/** The tool runner. */
export const ToolRunner = service<ToolRunnerService>('ai.tool-runner', {
  description: 'Validates and runs registered tools',
})

declare module '@aimbrace/core' {
  interface HookExtensions {
    'tool:before': (info: { name: string; args: unknown }) => void | Promise<void>
    'tool:after': (info: {
      name: string
      isError: boolean
      durationMs: number
    }) => void | Promise<void>
  }
}
