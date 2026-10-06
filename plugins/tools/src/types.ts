import type { Scope, StandardSchemaV1 } from '@aimbrace/core'

/** What a running tool is given. */
export interface ToolContext {
  /** Aborts when the caller cancels, the call times out, or the tools plugin is disposed. */
  readonly signal: AbortSignal
  /** The scope of the caller (for example an agent task), when there is one. */
  readonly scope?: Scope | undefined
}

/** A tool an agent can call. */
export interface Tool<A = unknown> {
  readonly name: string
  readonly description: string
  /** Validates and parses the arguments. Without it, arguments are passed through as given. */
  readonly input?: StandardSchemaV1<unknown, A> | undefined
  /** A JSON Schema shown to the model. */
  readonly parameters?: unknown
  run(args: A, ctx: ToolContext): unknown | Promise<unknown>
}

/** Identity helper that infers `A` from `input`. */
export function defineTool<A>(tool: Tool<A>): Tool<A> {
  return tool
}

/** A tool as a model should see it. */
export interface ToolDescription {
  readonly name: string
  readonly description: string
  readonly parameters?: unknown
}

/** The outcome of one call. Never throws: failures are results with `isError`. */
export interface ToolResult {
  readonly name: string
  /** What goes back to the model. */
  readonly content: string
  readonly isError: boolean
  /** The raw value the tool returned. */
  readonly value?: unknown
  /** True when the call was cut short by an abort or a timeout. */
  readonly interrupted?: boolean
}

/** Options of one call. */
export interface CallOptions {
  signal?: AbortSignal | undefined
  scope?: Scope | undefined
  /** Give up after this many milliseconds. */
  timeoutMs?: number | undefined
}

/** Runs the tools registered right now. */
export interface ToolRunnerService {
  list(): ToolDescription[]
  call(name: string, args: unknown, options?: CallOptions): Promise<ToolResult>
}
