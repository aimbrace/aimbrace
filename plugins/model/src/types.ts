/** Who wrote a message. */
export type Role = 'system' | 'user' | 'assistant' | 'tool'

/** A tool the model asked to run. */
export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: Readonly<Record<string, unknown>>
}

/** One message of a conversation. */
export interface Message {
  readonly role: Role
  readonly content: string
  /** Set on assistant messages that request tools. */
  readonly toolCalls?: readonly ToolCall[] | undefined
  /** Set on tool messages: the call they answer. */
  readonly toolCallId?: string | undefined
}

/** A tool as the model sees it. */
export interface ToolSpec {
  readonly name: string
  readonly description: string
  /** A JSON Schema describing the arguments, when the tool has one. */
  readonly parameters?: unknown
}

/** What a call cost. */
export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
}

export interface ModelRequest {
  readonly messages: readonly Message[]
  readonly tools?: readonly ToolSpec[] | undefined
  readonly maxOutputTokens?: number | undefined
}

export type FinishReason = 'stop' | 'tool_calls' | 'length'

export interface ModelResponse {
  readonly message: Message
  readonly usage: Usage
  readonly finishReason: FinishReason
}

/** A source of completions: a vendor adapter, a local model, a mock. Contributed to the `ModelProviders` registry. */
export interface ModelProvider {
  readonly id: string
  complete(request: ModelRequest, options: { signal: AbortSignal }): Promise<ModelResponse>
}

/** Options of one `Model.complete` call. */
export interface CompleteOptions {
  /** Aborts the call. The provider receives it. */
  signal?: AbortSignal | undefined
  /** Use this provider instead of the configured default. */
  provider?: string | undefined
}

/** The service the rest of the system talks to. */
export interface ModelService {
  complete(request: ModelRequest, options?: CompleteOptions): Promise<ModelResponse>
  /** Ids of the providers registered right now. */
  providers(): string[]
}

/** A rough token estimate: four characters per token. */
export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4)
}
