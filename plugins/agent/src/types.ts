import type { Message, Usage } from '@aimbrace/plugin-model'

export type AgentStatus = 'completed' | 'max_steps' | 'budget_exceeded' | 'cancelled' | 'error'

/** One thing that happened during a run. */
export interface AgentStep {
  /** The model round it belongs to, starting at 1. */
  readonly index: number
  readonly kind: 'model' | 'tool'
  readonly summary: string
  readonly tool?: string | undefined
  readonly isError?: boolean | undefined
  readonly tokens?: Usage | undefined
}

/** The outcome of one run. A run always produces a result, even when cancelled. */
export interface AgentResult {
  readonly id: string
  readonly status: AgentStatus
  /** The final answer, when there is one. */
  readonly output: string | undefined
  readonly steps: readonly AgentStep[]
  readonly usage: Usage
  readonly messages: readonly Message[]
  readonly error?: string | undefined
}

/** Options of one run. They override the plugin config for that run. */
export interface RunOptions {
  /** Use this run id instead of a generated one (for example a request id). Must not be in flight already. */
  id?: string | undefined
  /** Cancels the run. */
  signal?: AbortSignal | undefined
  /** Token budget for this run (input plus output, summed over model calls). */
  budgetTokens?: number | undefined
  maxSteps?: number | undefined
  systemPrompt?: string | undefined
}

export interface AgentService {
  run(input: string, options?: RunOptions): Promise<AgentResult>
  /** Ids of the runs in flight. */
  active(): string[]
  /** Cancel one run. Returns false when there is no such run in flight or it is already being cancelled. */
  cancel(id: string): boolean
  cancelAll(): void
}

/**
 * The token budget of one run. Provided as a scope-local service, so tools
 * running inside the task can read it, and it disappears with the task.
 */
export class Budget {
  readonly limit: number
  #used = 0

  constructor(limit: number) {
    this.limit = limit
  }

  get used(): number {
    return this.#used
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.#used)
  }

  /** True once the budget is spent. Checked before each model call, so the last call may overshoot. */
  get exceeded(): boolean {
    return this.#used >= this.limit
  }

  spend(usage: Usage): void {
    this.#used += usage.inputTokens + usage.outputTokens
  }
}
