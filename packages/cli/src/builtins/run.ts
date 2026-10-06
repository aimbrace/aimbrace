import { parseArgs } from 'node:util'
import { processSignal } from '../io'
import { type Builtin, formatError, loadProjectApp } from './shared'

/**
 * `aimbrace run [--once] [--inspect]`: start the app, report what runs, wait for
 * SIGINT or SIGTERM, then stop in reverse order. `--once` starts and stops at once.
 */
export const runCommand: Builtin = async (ctx) => {
  const { values } = parseArgs({
    args: [...ctx.args],
    options: {
      once: { type: 'boolean', default: false },
      inspect: { type: 'boolean', default: false },
    },
    strict: true,
  })
  const app = await loadProjectApp(ctx)
  try {
    await app.start()
  } catch (error) {
    ctx.io.stderr.write(formatError(error, ctx.debug))
    return 1
  }
  const snapshot = app.inspect()
  ctx.io.stdout.write(
    `Started "${snapshot.name}" with ${snapshot.plugins.length} plugin${snapshot.plugins.length === 1 ? '' : 's'}\n`,
  )
  for (const plugin of snapshot.plugins) ctx.io.stdout.write(`  ${plugin.key} ${plugin.state}\n`)
  if (values.inspect) ctx.io.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`)
  if (!values.once) {
    const signal = ctx.io.signal ?? processSignal()
    if (!signal.aborted)
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
  }
  try {
    await app.stop()
  } catch (error) {
    ctx.io.stderr.write(formatError(error, ctx.debug))
    return 1
  }
  ctx.io.stdout.write('Stopped\n')
  return 0
}
