import manifest from '../deno.json' with { type: 'json' }
import { init, parseInitOptions, UsageError } from './init.ts'
import { type Io, processIo } from './io.ts'

/** The version of this package. */
export const VERSION: string = manifest.version

export const HELP = `aimbrace ${VERSION} - scaffold Cordis apps on Deno

Usage:
  aimbrace init [dir] [options]   Create a Cordis app in an empty or new directory

Options for init:
  --agent / --no-agent   include the offline agent (asked when not given)
  --name <name>          the project name (default: the directory name)
  --install              run deno install after copying
  -y, --yes              ask nothing; use defaults (no agent, no install)

  -h, --help             show this help
  -v, --version          show the version
`

/** Run the CLI and return the exit code: 0 done, 1 failed or refused, 2 a usage error. */
export async function runCli(argv: readonly string[], io: Io = processIo()): Promise<number> {
  const [command, ...args] = argv
  try {
    if (command === undefined || ['help', '-h', '--help'].includes(command)) {
      io.stdout(HELP)
      return command === undefined ? 2 : 0
    }
    if (['version', '-v', '--version'].includes(command)) {
      io.stdout(`${VERSION}\n`)
      return 0
    }
    if (command === 'init') return await init(parseInitOptions(args), io)
    throw new UsageError(`unknown command "${command}"`)
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`error: ${error.message}\n\n${HELP}`)
      return 2
    }
    io.stderr(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
