import { checkCommand } from './check'
import { commandsCommand } from './commands'
import { graphCommand } from './graph'
import { initCommand } from './init'
import { pluginsCommand } from './plugins'
import { runCommand } from './run'
import type { Builtin } from './shared'

/** The commands the CLI owns. */
export const builtins: Record<string, Builtin | undefined> = {
  graph: graphCommand,
  check: checkCommand,
  run: runCommand,
  plugins: pluginsCommand,
  commands: commandsCommand,
  init: initCommand,
}
