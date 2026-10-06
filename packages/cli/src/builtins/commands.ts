import { Commands } from '../commands'
import { type Builtin, formatError, loadProjectApp } from './shared'

/** `aimbrace commands`: start the app and list the commands its plugins contribute. */
export const commandsCommand: Builtin = async (ctx) => {
  const app = await loadProjectApp(ctx)
  try {
    await app.start()
  } catch (error) {
    ctx.io.stderr.write(formatError(error, ctx.debug))
    return 1
  }
  const commands = app.registry(Commands).all()
  if (commands.length === 0) ctx.io.stdout.write('No plugin commands registered.\n')
  const width = Math.max(0, ...commands.map((command) => (command.usage ?? command.name).length))
  for (const command of commands) {
    ctx.io.stdout.write(
      `${(command.usage ?? command.name).padEnd(width)}  ${command.description ?? ''}\n`.trimEnd() +
        '\n',
    )
  }
  await app.stop()
  return 0
}
