import { createApp, definePlugin } from '@aimbrace/core'
import { startTestApp, withApp } from '@aimbrace/testing'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import toolsPlugin, {
  builtinTools,
  CalculatorError,
  calculate,
  calculatorTool,
  clockTool,
  toolsPlugin as contribute,
  defineTool,
  formatNumber,
  ToolRunner,
  Tools,
} from '../src'

describe('calculate', () => {
  it.each([
    ['2+3', 5],
    ['2 + 3 * 4', 14],
    ['(2 + 3) * 4', 20],
    ['10 / 4', 2.5],
    ['10 % 4', 2],
    ['2 ^ 3 ^ 2', 512],
    ['-3 + 5', 2],
    ['--3', 3],
    ['+4', 4],
    ['-(2 + 3) ^ 2', -25],
    ['1.5 * 2', 3],
    ['.5 + .5', 1],
    ['1e3 + 1', 1001],
    ['2*-3', -6],
  ])('%s = %s', (source, expected) => {
    expect(calculate(source)).toBe(expected)
  })

  it.each([
    ['', /empty/],
    ['2 +', /ends too early/],
    ['(2 + 3', /closing parenthesis/],
    ['2 + * 3', /Unexpected "\*"/],
    ['2 3', /Unexpected "3"/],
    ['1 / 0', /Division by zero/],
    ['1 % 0', /Division by zero/],
    ['2 ** 3', /Unexpected "\*"/],
    ['process.exit()', /Unexpected "p" at position 1/],
    ['alert(1)', /Unexpected "a"/],
    ['10 ^ 1000', /not a finite number/],
    [')', /Unexpected "\)"/],
  ])('rejects %j', (source, pattern) => {
    expect(() => calculate(source)).toThrow(CalculatorError)
    expect(() => calculate(source)).toThrow(pattern)
  })

  it('formats without float noise', () => {
    expect(formatNumber(calculate('0.1 + 0.2'))).toBe('0.3')
    expect(formatNumber(5)).toBe('5')
    expect(formatNumber(1 / 3)).toBe('0.333333333333')
  })
})

const wait = defineTool({
  name: 'wait',
  description: 'Waits',
  input: v.object({ ms: v.number() }),
  async run({ ms }, { signal }) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(signal.reason)
      })
    })
    return `waited ${ms}`
  },
})
const stubborn = defineTool({
  name: 'stubborn',
  description: 'Ignores its signal',
  run: () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 200)),
})
const broken = defineTool({
  name: 'broken',
  description: 'Throws',
  run() {
    throw new Error('disk on fire')
  },
})
const returnsObject = defineTool({
  name: 'object',
  description: 'Returns an object',
  run: () => ({ a: 1 }),
})
const returnsNothing = defineTool({
  name: 'nothing',
  description: 'Returns nothing',
  run: () => undefined,
})

describe('tool runner', () => {
  const plugins = [
    toolsPlugin,
    builtinTools,
    contribute('extras', [wait, stubborn, broken, returnsObject, returnsNothing]),
  ]

  it('lists tools with their descriptions and parameters', async () => {
    await withApp({ plugins }, (app) => {
      const list = app.get(ToolRunner).list()
      expect(list.map((tool) => tool.name)).toEqual([
        'calculator',
        'clock',
        'wait',
        'stubborn',
        'broken',
        'object',
        'nothing',
      ])
      expect(list[0]).toMatchObject({
        name: 'calculator',
        parameters: { required: ['expression'] },
      })
      expect('parameters' in (list[2] as object)).toBe(false)
    })
  })

  it('runs a tool and turns the value into content', async () => {
    await withApp({ plugins }, async (app) => {
      const runner = app.get(ToolRunner)
      expect(await runner.call('calculator', { expression: '2 + 3 * 4' })).toMatchObject({
        content: '14',
        isError: false,
        value: '14',
      })
      expect(await runner.call('object', {})).toMatchObject({ content: '{"a":1}', isError: false })
      expect(await runner.call('nothing', {})).toMatchObject({ content: 'ok', isError: false })
    })
  })

  it('reports problems as results, never as exceptions', async () => {
    await withApp({ plugins }, async (app) => {
      const runner = app.get(ToolRunner)
      expect(await runner.call('nope', {})).toMatchObject({
        isError: true,
        content: expect.stringContaining('Unknown tool "nope". Available tools: calculator'),
      })
      const invalid = await runner.call('calculator', { expression: 42 })
      expect(invalid.isError).toBe(true)
      expect(invalid.content).toContain('Invalid arguments for tool "calculator"')
      expect(invalid.content).toContain('(at expression)')
      expect((await runner.call('calculator', { expression: '1/0' })).content).toBe(
        'Tool "calculator" failed: Division by zero.',
      )
      expect((await runner.call('broken', {})).content).toBe('Tool "broken" failed: disk on fire')
    })
  })

  it('times out slow tools, including ones that ignore their signal', async () => {
    await withApp({ plugins }, async (app) => {
      const runner = app.get(ToolRunner)
      const cooperative = await runner.call('wait', { ms: 500 }, { timeoutMs: 30 })
      expect(cooperative).toMatchObject({
        isError: true,
        interrupted: true,
        content: 'Tool "wait" timed out after 30ms.',
      })
      const ignoring = await runner.call('stubborn', {}, { timeoutMs: 30 })
      expect(ignoring).toMatchObject({ isError: true, interrupted: true })
      expect((await runner.call('wait', { ms: 5 }, { timeoutMs: 500 })).content).toBe('waited 5')
    })
  })

  it('stops a call when the caller aborts', async () => {
    await withApp({ plugins }, async (app) => {
      const controller = new AbortController()
      const pending = app.get(ToolRunner).call('wait', { ms: 5000 }, { signal: controller.signal })
      controller.abort()
      expect(await pending).toMatchObject({
        isError: true,
        interrupted: true,
        content: 'Tool "wait" was cancelled.',
      })
      const already = new AbortController()
      already.abort()
      expect(
        await app.get(ToolRunner).call('wait', { ms: 1 }, { signal: already.signal }),
      ).toMatchObject({ interrupted: true })
    })
  })

  it('hands the caller scope to the tool', async () => {
    let seen: string | undefined
    const spy = defineTool({
      name: 'spy',
      description: 'x',
      run(_args, ctx) {
        seen = ctx.scope?.name
      },
    })
    await withApp({ plugins: [toolsPlugin, contribute('spy', [spy])] }, async (app) => {
      const scope = await app.scope('caller')
      await app.get(ToolRunner).call('spy', {}, { scope })
      await scope.dispose()
    })
    expect(seen).toBe('caller')
  })

  it('fires before and after hooks with timing', async () => {
    const events: string[] = []
    const app = createApp({ plugins })
    app.hooks.hook(
      'tool:before',
      (info) => void events.push(`before ${info.name} ${JSON.stringify(info.args)}`),
    )
    app.hooks.hook(
      'tool:after',
      (info) => void events.push(`after ${info.name} ${info.isError} ${info.durationMs >= 0}`),
    )
    await app.start()
    await app.get(ToolRunner).call('calculator', { expression: '1+1' })
    await app.get(ToolRunner).call('broken', {})
    expect(events).toEqual([
      'before calculator {"expression":"1+1"}',
      'after calculator false true',
      'before broken {}',
      'after broken true true',
    ])
    await app.stop()
  })

  it('drops tools when their plugin is disposed and picks up new ones live', async () => {
    await using t = await startTestApp({ plugins: [toolsPlugin] })
    const runner = t.app.get(ToolRunner)
    expect(runner.list()).toEqual([])
    const handle = await t.app.install(contribute('late', [broken]))
    expect(runner.list().map((tool) => tool.name)).toEqual(['broken'])
    await handle.dispose()
    expect(runner.list()).toEqual([])
    expect(t.app.registry(Tools).size).toBe(0)
  })

  it('aborts a running tool when the tools plugin is disposed', async () => {
    const app = createApp({ plugins: [toolsPlugin, contribute('extras', [wait])] })
    await app.start()
    const pending = app.get(ToolRunner).call('wait', { ms: 5000 })
    await app.stop()
    expect(await pending).toMatchObject({ isError: true, interrupted: true })
    expect(app.probe().clean).toBe(true)
  })

  it('works with the clock tool and a fixed time', async () => {
    const fixed = clockTool(() => new Date('2026-01-02T03:04:05.000Z'))
    await withApp({ plugins: [toolsPlugin, contribute('clock', [fixed])] }, async (app) => {
      expect((await app.get(ToolRunner).call('clock', undefined)).content).toBe(
        '2026-01-02T03:04:05.000Z',
      )
    })
    expect(calculatorTool.name).toBe('calculator')
    expect(definePlugin).toBeDefined()
  })
})
