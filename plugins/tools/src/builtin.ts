import { definePlugin, type Plugin } from '@aimbrace/core'
import * as v from 'valibot'
import { calculate, formatNumber } from './calculator'
import { Tools } from './tokens'
import { defineTool, type Tool } from './types'

/** Evaluates arithmetic. Parsed, never evaluated as code. */
export const calculatorTool: Tool<{ expression: string }> = defineTool({
  name: 'calculator',
  description:
    'Evaluate an arithmetic expression such as "2 + 3 * (4 - 1)". Supports + - * / % ^ and parentheses.',
  parameters: {
    type: 'object',
    properties: { expression: { type: 'string', description: 'The expression to evaluate' } },
    required: ['expression'],
  },
  input: v.object({ expression: v.pipe(v.string(), v.minLength(1), v.maxLength(200)) }),
  run: ({ expression }) => formatNumber(calculate(expression)),
})

/** The current time as an ISO string. The clock is injectable so tests are deterministic. */
export function clockTool(now: () => Date = () => new Date()): Tool<undefined> {
  return defineTool({
    name: 'clock',
    description: 'Get the current date and time as an ISO 8601 string.',
    parameters: { type: 'object', properties: {} },
    run: () => now().toISOString(),
  })
}

/** Contribute tools to the `Tools` registry for as long as the plugin is installed. */
export function toolsPlugin(id: string, tools: readonly Tool[]): Plugin {
  return definePlugin({
    id,
    setup(ctx) {
      for (const tool of tools) ctx.registry(Tools).add(tool)
    },
  }) as unknown as Plugin
}

/** The built-in `calculator` and `clock` tools as a plugin. */
export const builtinTools: Plugin = toolsPlugin('tools-builtin', [
  calculatorTool as Tool,
  clockTool() as Tool,
])
