import { createApp, definePlugin } from '@aimbrace/core'
import { withApp } from '@aimbrace/testing'
import { describe, expect, it } from 'vitest'
import model, {
  createMockProvider,
  createScriptedProvider,
  estimateTokens,
  type Message,
  Model,
  ModelProviders,
  mockModel,
  NoModelProviderError,
  providerPlugin,
  respondMock,
} from '../src'

const user = (content: string): Message => ({ role: 'user', content })
const tools = [
  { name: 'calculator', description: 'math' },
  { name: 'clock', description: 'time' },
  { name: 'note', description: 'notes' },
]

describe('respondMock', () => {
  it('echoes plain text and estimates usage', () => {
    const response = respondMock({ messages: [user('hello world!')] })
    expect(response.message).toEqual({ role: 'assistant', content: 'You said: hello world!' })
    expect(response.finishReason).toBe('stop')
    expect(response.usage).toEqual({
      inputTokens: estimateTokens('hello world!'),
      outputTokens: estimateTokens('You said: hello world!'),
    })
  })

  it('calls tools that exist and only those', () => {
    const calc = respondMock({ messages: [user('calc: 2+3')], tools })
    expect(calc.finishReason).toBe('tool_calls')
    expect(calc.message.toolCalls).toEqual([
      { id: 'call_1', name: 'calculator', arguments: { expression: '2+3' } },
    ])
    expect(respondMock({ messages: [user('time')], tools }).message.toolCalls?.[0]?.name).toBe(
      'clock',
    )
    expect(
      respondMock({ messages: [user('note: buy milk')], tools }).message.toolCalls?.[0]?.arguments,
    ).toEqual({ text: 'buy milk' })
    expect(respondMock({ messages: [user('calc: 2+3')], tools: [] }).message.content).toBe(
      'You said: calc: 2+3',
    )
  })

  it('turns a tool result into a final answer', () => {
    const response = respondMock({
      messages: [
        user('calc: 2+3'),
        { role: 'assistant', content: 'x' },
        { role: 'tool', content: '5', toolCallId: 'call_1' },
      ],
      tools,
    })
    expect(response.message.content).toBe('The answer is 5.')
    expect(response.finishReason).toBe('stop')
  })

  it('numbers tool calls and supports the loop and expensive scenarios', () => {
    const looping = respondMock({
      messages: [user('loop'), { role: 'tool', content: 't', toolCallId: 'call_1' }],
      tools,
    })
    expect(looping.finishReason).toBe('tool_calls')
    expect(looping.message.toolCalls?.[0]?.id).toBe('call_2')
    expect(respondMock({ messages: [user('expensive')] }).usage.outputTokens).toBeGreaterThan(5000)
  })
})

describe('mock provider', () => {
  it('honours the abort signal, also while pretending to be slow', async () => {
    const provider = createMockProvider({ delayMs: 1000 })
    const controller = new AbortController()
    const pending = provider.complete({ messages: [user('hi')] }, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeDefined()
    const already = new AbortController()
    already.abort()
    await expect(
      createMockProvider().complete({ messages: [] }, { signal: already.signal }),
    ).rejects.toBeDefined()
  })
})

describe('model plugin', () => {
  it('routes to the first registered provider and fires hooks', async () => {
    const events: string[] = []
    const app = createApp({ plugins: [model, mockModel()] })
    app.hooks.hook(
      'model:request',
      (info) => void events.push(`request ${info.provider} ${info.messages}/${info.tools}`),
    )
    app.hooks.hook(
      'model:response',
      (info) => void events.push(`response ${info.provider} ${info.finishReason}`),
    )
    await app.start()
    const response = await app.get(Model).complete({ messages: [user('hi')], tools })
    expect(response.message.content).toBe('You said: hi')
    expect(events).toEqual(['request mock 1/3', 'response mock stop'])
    expect(app.get(Model).providers()).toEqual(['mock'])
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('picks the configured provider, or the one named in the call', async () => {
    const a = createScriptedProvider('a', [
      {
        message: { role: 'assistant', content: 'from a' },
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'stop',
      },
    ])
    const b = createScriptedProvider('b', [
      {
        message: { role: 'assistant', content: 'from b' },
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'stop',
      },
    ])
    await withApp(
      { plugins: [model({ provider: 'b' }), providerPlugin('pa', a), providerPlugin('pb', b)] },
      async (app) => {
        expect((await app.get(Model).complete({ messages: [] })).message.content).toBe('from b')
        expect(
          (await app.get(Model).complete({ messages: [] }, { provider: 'a' })).message.content,
        ).toBe('from a')
        expect(a.calls).toHaveLength(1)
      },
    )
  })

  it('explains when no provider fits, and notices providers coming and going', async () => {
    await withApp({ plugins: [model] }, async (app) => {
      const empty = await app
        .get(Model)
        .complete({ messages: [] })
        .catch((e: unknown) => e)
      expect(empty).toBeInstanceOf(NoModelProviderError)
      expect((empty as Error).message).toContain('No model provider is registered')
      const handle = await app.install(mockModel())
      expect(await app.get(Model).complete({ messages: [user('x')] })).toBeDefined()
      await app.install(providerPlugin('late', createMockProvider({ id: 'late' })))
      await expect(app.get(Model).complete({ messages: [] }, { provider: 'nope' })).rejects.toThrow(
        /No model provider "nope" is registered \(available: mock, late\)/,
      )
      await handle.dispose()
      expect(app.get(Model).providers()).toEqual(['late'])
      expect(app.registry(ModelProviders).size).toBe(1)
    })
  })

  it('aborts a provider call when the caller aborts or the plugin is disposed', async () => {
    await withApp({ plugins: [model, mockModel({ delayMs: 5000 })] }, async (app) => {
      const controller = new AbortController()
      const pending = app
        .get(Model)
        .complete({ messages: [user('slow')] }, { signal: controller.signal })
      controller.abort()
      await expect(pending).rejects.toBeDefined()
    })
    const app = createApp({ plugins: [model, mockModel({ delayMs: 5000 })] })
    await app.start()
    const pending = app.get(Model).complete({ messages: [user('slow')] })
    const settled = pending.then(
      () => 'resolved',
      () => 'rejected',
    )
    await app.stop()
    expect(await settled).toBe('rejected')
    expect(app.probe().clean).toBe(true)
  })

  it('validates its config', async () => {
    const app = createApp({ plugins: [model({ provider: 3 as never })] })
    await expect(app.start()).rejects.toThrow(/Invalid config for plugin "model"/)
  })

  it('is a plugin like any other', () => {
    expect(model.meta.provides).toEqual(['ai.model'])
    expect(definePlugin).toBeDefined()
  })
})
