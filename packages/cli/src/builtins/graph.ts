import { parseArgs } from 'node:util'
import { UsageError } from '../args'
import { type Builtin, loadProjectApp } from './shared'

const FORMATS = ['text', 'mermaid', 'dot', 'json'] as const

/** `aimbrace graph [--format text|mermaid|dot|json]`: print the dependency graph. Exit 1 when it is invalid. */
export const graphCommand: Builtin = async (ctx) => {
  const { values } = parseArgs({
    args: [...ctx.args],
    options: { format: { type: 'string', short: 'f', default: 'text' } },
    strict: true,
  })
  const format = values.format as string
  if (!(FORMATS as readonly string[]).includes(format)) {
    throw new UsageError(`Unknown format "${format}". Use one of: ${FORMATS.join(', ')}.`)
  }
  const graph = (await loadProjectApp(ctx)).graph()
  const text =
    format === 'mermaid'
      ? graph.toMermaid()
      : format === 'dot'
        ? graph.toDot()
        : format === 'json'
          ? JSON.stringify(graph.toJSON(), null, 2)
          : graph.toText()
  ctx.io.stdout.write(`${text}\n`)
  if (!graph.ok) {
    for (const error of graph.errors) ctx.io.stderr.write(`error: ${error.message}\n`)
    return 1
  }
  return 0
}
