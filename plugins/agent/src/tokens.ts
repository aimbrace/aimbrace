import { service } from '@aimbrace/core'
import type { Usage } from '@aimbrace/plugin-model'
import type { AgentService, AgentStatus, AgentStep, Budget } from './types'

/** The agent. */
export const Agent = service<AgentService>('ai.agent', {
  description: 'Runs tool-using agent tasks, one scope per run',
})

/** The token budget of the current task. Only available inside a task scope. */
export const BudgetToken = service<Budget>('ai.budget', {
  description: 'Token budget of the current task',
})

declare module '@aimbrace/core' {
  interface HookExtensions {
    'agent:start': (info: { id: string; input: string }) => void | Promise<void>
    'agent:step': (info: { id: string; step: AgentStep }) => void | Promise<void>
    'agent:end': (info: {
      id: string
      status: AgentStatus
      usage: Usage
      steps: number
    }) => void | Promise<void>
  }
}
