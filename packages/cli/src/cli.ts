import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { extractGlobals, UsageError } from './args'
import { builtins } from './builtins'
import { formatError, loadProjectApp } from './builtins/shared'
import { type Command, Commands } from './commands'
import { defaultIo, type Io } from './io'

/** The version of this package. */
export const VERSION: string = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version

const HELP = `aimbrace ${VERSION} - the AIMBRACE command line

Usage: aimbrace [options] <command> [args]

Commands:
  graph [--format text|mermaid|dot|json]   Print the plugin dependency graph (exit 1 if invalid)
  check                                    Validate the graph and every plugin config (runs no setup)
  run [--once] [--inspect]                 Start the app; stop on SIGINT or SIGTERM
  plugins                                  List installed plugin packages
  commands                                 List commands contributed by your plugins
  init [dir]                               Scaffold a config and a first plugin
  help                                     Show this help
  <name> [args]                            Run a command contributed by a plugin

Options:
  -c, --config <file>   Config module or aimbrace.json (default: search upwards)
      --cwd <dir>       Work in another directory
      --debug           Print stack traces
  -h, --help            Show this help
  -v, --version         Show the version
`

async function runCustom(
  name: string,
  args: readonly string[],
  context: { config: string | undefined; cwd: string; io: Io; debug: boolean },
): Promise<number> {
  const app = await loadProjectApp({ args, ...context })
  try {
    await app.start()
  } catch (error) {
    context.io.stderr.write(formatError(error, context.debug))
    return 1
  }
  let command: Command | undefined
  try {
    command = app.registry(Commands).get(name)
    if (!command) {
      const known = app
        .registry(Commands)
        .all()
        .map((entry) => entry.name)
      context.io.stderr.write(
        `error: unknown command "${name}".${known.length > 0 ? ` Plugin commands: ${known.join(', ')}.` : ''}\nRun "aimbrace help" for usage.\n`,
      )
      return 2
    }
    const { values, positionals } = parseArgs({
      args: [...args],
      options: { ...(command.options ?? {}) } as never,
      allowPositionals: true,
      strict: true,
    })
    const scope = await app.scope(`command:${name}`)
    try {
      const code = await command.run({
        name,
        args: positionals,
        values: values as never,
        scope,
        stdout: context.io.stdout,
        stderr: context.io.stderr,
        cwd: context.cwd,
      })
      return typeof code === 'number' ? code : 0
    } finally {
      await scope.dispose()
    }
  } finally {
    await app
      .stop()
      .catch((error: unknown) => context.io.stderr.write(formatError(error, context.debug)))
  }
}

/** Bad command line input: our own usage errors and the ones `util.parseArgs` throws. */
function isUsageProblem(error: unknown): boolean {
  if (error instanceof UsageError) return true
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS')
}

/**
 * Run the CLI. Never calls `process.exit`: returns the exit code, writes
 * through `io`, and waits on `io.signal` (default: SIGINT/SIGTERM) in `run`.
 *
 * @returns 0 on success, 1 on failure, 2 on a usage error
 */
export async function runCli(
  argv: readonly string[],
  overrides: Partial<Io> = {},
): Promise<number> {
  const io: Io = { ...defaultIo(), ...overrides }
  let debug = argv.includes('--debug')
  try {
    const globals = extractGlobals(argv)
    debug = globals.debug
    if (globals.version) {
      io.stdout.write(`${VERSION}\n`)
      return 0
    }
    const [name, ...args] = globals.rest
    if (globals.help || name === undefined || name === 'help') {
      io.stdout.write(HELP)
      return globals.help || name === 'help' ? 0 : 2
    }
    if (name === 'version') {
      io.stdout.write(`${VERSION}\n`)
      return 0
    }
    const cwd = globals.cwd ? resolve(io.cwd, globals.cwd) : io.cwd
    const context = { config: globals.config, cwd, io: { ...io, cwd }, debug }
    const builtin = builtins[name]
    if (builtin) return await builtin({ args, ...context })
    return await runCustom(name, args, context)
  } catch (error) {
    io.stderr.write(formatError(error, debug))
    return isUsageProblem(error) ? 2 : 1
  }
}
