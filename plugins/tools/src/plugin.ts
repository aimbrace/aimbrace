import { ConfigError, definePlugin, type PluginContext, validateStandard } from '@aimbrace/core'
import { ToolRunner, Tools } from './tokens'
import type { Tool, ToolResult, ToolRunnerService } from './types'

function failure(name: string, content: string, extra: Partial<ToolResult> = {}): ToolResult {
  return { name, content, isError: true, ...extra }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Reject when `signal` aborts, whatever the tool does with it. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

type ToolsContext = Pick<PluginContext, 'registry' | 'hooks' | 'signal' | 'report'>

function createRunner(ctx: ToolsContext): ToolRunnerService {
  const tools = ctx.registry(Tools)
  return {
    list: () =>
      tools.all().map((tool) => ({
        name: tool.name,
        description: tool.description,
        ...(tool.parameters === undefined ? {} : { parameters: tool.parameters }),
      })),
    async call(name, args, options = {}) {
      const tool: Tool | undefined = tools.get(name)
      if (!tool) {
        const known = tools.all().map((entry) => entry.name)
        return failure(
          name,
          `Unknown tool "${name}". Available tools: ${known.join(', ') || 'none'}.`,
        )
      }
      const started = performance.now()
      let result: ToolResult
      try {
        let parsed: unknown = args
        if (tool.input) {
          try {
            parsed = await validateStandard(tool.input, args, `tool "${name}"`)
          } catch (error) {
            if (!(error instanceof ConfigError)) throw error
            const issues = error.issues.map(
              (issue) => `${issue.message}${issue.path ? ` (at ${issue.path})` : ''}`,
            )
            return failure(name, `Invalid arguments for tool "${name}": ${issues.join('; ')}.`)
          }
        }
        await ctx.hooks.callHook('tool:before', { name, args: parsed })
        const signals = [
          ctx.signal,
          options.signal,
          options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
        ].filter((signal): signal is AbortSignal => signal !== undefined)
        const signal = AbortSignal.any(signals)
        const value = await raceAbort(
          Promise.resolve(tool.run(parsed as never, { signal, scope: options.scope })),
          signal,
        )
        const content =
          value === undefined ? 'ok' : typeof value === 'string' ? value : JSON.stringify(value)
        result = { name, content, isError: false, value }
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
        const aborted = error instanceof DOMException && error.name === 'AbortError'
        result =
          timedOut || aborted
            ? failure(
                name,
                timedOut
                  ? `Tool "${name}" timed out after ${options.timeoutMs}ms.`
                  : `Tool "${name}" was cancelled.`,
                {
                  interrupted: true,
                },
              )
            : failure(name, `Tool "${name}" failed: ${describeError(error)}`)
      }
      await ctx.hooks
        .callHook('tool:after', {
          name,
          isError: result.isError,
          durationMs: performance.now() - started,
        })
        .catch((error: unknown) => ctx.report(error, 'tool:after hook'))
      return result
    },
  }
}

/** Provides the {@link ToolRunner} over the live `Tools` registry. */
export const tools = definePlugin({
  id: 'tools',
  version: '0.1.0',
  description: 'Validates and runs registered tools',
  provides: [ToolRunner],
  setup(ctx) {
    ctx.provide(ToolRunner, createRunner(ctx as unknown as ToolsContext))
  },
})

export default tools
