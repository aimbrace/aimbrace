import { AimbraceError, definePlugin, type Plugin, registry, type Scope } from '@aimbrace/core'
import type { Writer } from './io'

/** How one option of a command is parsed (the shape of `util.parseArgs` options). */
export interface OptionSpec {
  type: 'string' | 'boolean'
  short?: string
  multiple?: boolean
  default?: string | boolean | string[] | boolean[]
}

/** Everything a command receives. */
export interface CommandContext {
  readonly name: string
  /** Positional arguments after the command name. */
  readonly args: readonly string[]
  /** Parsed options, as declared in `Command.options`. */
  readonly values: Readonly<Record<string, string | boolean | Array<string | boolean> | undefined>>
  /** A scope that lives for this command run. Read services with `scope.get(Token)`. */
  readonly scope: Scope
  readonly stdout: Writer
  readonly stderr: Writer
  readonly cwd: string
}

/** A command a plugin contributes to the CLI. Return a number to set the exit code. */
export interface Command {
  readonly name: string
  readonly description?: string | undefined
  /** Shown by `aimbrace commands`, for example `migrate [--dry-run]`. */
  readonly usage?: string | undefined
  readonly options?: Readonly<Record<string, OptionSpec>> | undefined
  run(ctx: CommandContext): number | undefined | void | Promise<number | undefined | void>
}

/** Commands contributed by plugins. The CLI host starts the app and runs the one named on the command line. */
export const Commands = registry<Command>('cli.commands', {
  description: 'CLI commands contributed by plugins',
  key: (command) => command.name,
})

/** Names the CLI itself owns. */
export const RESERVED_COMMANDS: readonly string[] = [
  'graph',
  'check',
  'run',
  'plugins',
  'init',
  'commands',
  'help',
  'version',
]

const NAME = /^[a-z][a-z0-9:-]*$/

/**
 * A plugin that only contributes commands. It does not import the CLI host's
 * internals, so it works wherever the `Commands` registry is served.
 *
 * @example
 * export default commandsPlugin('db-tools', [
 *   { name: 'migrate', description: 'Apply migrations', run: (ctx) => ctx.stdout.write('done\n') },
 * ])
 */
export function commandsPlugin(id: string, commands: readonly Command[]): Plugin {
  for (const command of commands) {
    if (!NAME.test(command.name)) {
      throw new AimbraceError(
        'E_INVALID_COMMAND',
        `Command name "${command.name}" must be lower case letters, digits, ":" and "-", starting with a letter.`,
      )
    }
    if (RESERVED_COMMANDS.includes(command.name)) {
      throw new AimbraceError(
        'E_RESERVED_COMMAND',
        `"${command.name}" is a built-in command and cannot be redefined by plugin "${id}".`,
      )
    }
  }
  return definePlugin({
    id,
    setup(ctx) {
      for (const command of commands) ctx.registry(Commands).add(command)
    },
  }) as unknown as Plugin
}
