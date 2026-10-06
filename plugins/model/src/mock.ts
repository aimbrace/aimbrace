import { definePlugin, type Plugin } from '@aimbrace/core'
import { ModelProviders } from './tokens'
import {
  estimateTokens,
  type Message,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type Usage,
} from './types'

function usageOf(request: ModelRequest, message: Message, extraOutput = 0): Usage {
  return {
    inputTokens: request.messages.reduce((sum, entry) => sum + estimateTokens(entry.content), 0),
    outputTokens: estimateTokens(message.content) + extraOutput,
  }
}

/** Wait, but stop early with an `AbortError` when the signal aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * The mock model's brain: a few deterministic rules, no randomness, no network.
 *
 * - after a tool result: `The answer is <result>.`
 * - `calc: <expression>` calls the `calculator` tool, `time` calls `clock`, `note: <text>` calls `note`
 * - `loop` keeps calling `clock` (to exercise step limits), `expensive` reports a large output usage (to exercise budgets)
 * - anything else is echoed
 */
export function respondMock(request: ModelRequest): ModelResponse {
  const last = request.messages[request.messages.length - 1]
  const firstUser = request.messages.find((message) => message.role === 'user')
  const has = (name: string) => request.tools?.some((tool) => tool.name === name) ?? false
  const toolMessages = request.messages.filter((message) => message.role === 'tool').length
  const call = (name: string, args: Record<string, unknown>): ModelResponse => {
    const message: Message = {
      role: 'assistant',
      content: `Calling ${name}.`,
      toolCalls: [{ id: `call_${toolMessages + 1}`, name, arguments: args }],
    }
    return { message, usage: usageOf(request, message), finishReason: 'tool_calls' }
  }

  if (firstUser?.content === 'loop' && has('clock')) return call('clock', {})
  if (last?.role === 'tool') {
    const message: Message = { role: 'assistant', content: `The answer is ${last.content}.` }
    return { message, usage: usageOf(request, message), finishReason: 'stop' }
  }
  const text = last?.content ?? ''
  const calc = /^calc:\s*(.+)$/i.exec(text)
  if (calc && has('calculator')) return call('calculator', { expression: calc[1] })
  if (/^time$/i.test(text) && has('clock')) return call('clock', {})
  const note = /^note:\s*(.+)$/i.exec(text)
  if (note && has('note')) return call('note', { text: note[1] })
  const message: Message = { role: 'assistant', content: `You said: ${text}` }
  return {
    message,
    usage: usageOf(request, message, text === 'expensive' ? 5000 : 0),
    finishReason: 'stop',
  }
}

/** Options of {@link createMockProvider}. */
export interface MockProviderOptions {
  id?: string
  /** Pretend the model is slow. Honours the abort signal. */
  delayMs?: number
}

/** A deterministic, offline provider built on {@link respondMock}. */
export function createMockProvider(options: MockProviderOptions = {}): ModelProvider {
  return {
    id: options.id ?? 'mock',
    async complete(request, { signal }) {
      if (options.delayMs) await sleep(options.delayMs, signal)
      signal.throwIfAborted()
      return respondMock(request)
    },
  }
}

/** A provider that replays fixed responses in order (and repeats the last one). For tests. */
export function createScriptedProvider(
  id: string,
  responses: readonly ModelResponse[],
): ModelProvider & { readonly calls: ModelRequest[] } {
  const calls: ModelRequest[] = []
  return {
    id,
    calls,
    async complete(request, { signal }) {
      signal.throwIfAborted()
      calls.push(request)
      const response = responses[Math.min(calls.length - 1, responses.length - 1)]
      if (!response) throw new Error('createScriptedProvider needs at least one response')
      return response
    },
  }
}

/** A plugin that registers a provider for as long as it is installed. */
export function providerPlugin(id: string, provider: ModelProvider): Plugin {
  return definePlugin({
    id,
    setup(ctx) {
      ctx.registry(ModelProviders).add(provider)
    },
  }) as unknown as Plugin
}

/** The mock provider as a ready-made plugin. */
export function mockModel(options: MockProviderOptions = {}): Plugin {
  return providerPlugin(`model-${options.id ?? 'mock'}`, createMockProvider(options))
}
