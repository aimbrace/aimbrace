import { type Builtin, loadProjectApp } from './shared'

/** `aimbrace check`: validate the graph and every plugin config. Runs no plugin `setup`. */
export const checkCommand: Builtin = async (ctx) => {
  const app = await loadProjectApp(ctx)
  const report = await app.validate()
  if (report.ok) {
    const count = report.graph.nodes.length
    ctx.io.stdout.write(
      `OK: ${count} plugin${count === 1 ? '' : 's'}${count > 0 ? ` (${report.graph.order.join(' -> ')})` : ''}\n`,
    )
    return 0
  }
  for (const error of report.errors) ctx.io.stderr.write(`error: ${error.message}\n`)
  ctx.io.stderr.write(
    `${report.errors.length} problem${report.errors.length === 1 ? '' : 's'} found.\n`,
  )
  return 1
}
