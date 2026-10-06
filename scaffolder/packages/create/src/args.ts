import { parseArgs } from 'node:util'
import type { Host } from './templates'

/** What the command line asked for. Anything left unset is asked for, or defaulted with `--yes`. */
export interface Options {
  directory: string | undefined
  name: string | undefined
  host: Host | undefined
  agent: boolean | undefined
  install: boolean
  yes: boolean
  help: boolean
  version: boolean
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

const HOSTS: readonly Host[] = ['hono', 'fastify']

/** Parse the flags. Positional: the target directory. */
export function parseOptions(argv: readonly string[]): Options {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>
  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true })
  } catch (error) {
    throw new UsageError((error as Error).message)
  }
  const { values, positionals } = parsed
  if (positionals.length > 1) throw new UsageError('expected at most one directory')
  const host = values.host
  if (host !== undefined && !HOSTS.includes(host as Host)) throw new UsageError(`--host must be "hono" or "fastify", got "${host}"`)
  if (values.agent === true && values['no-agent'] === true) throw new UsageError('use --agent or --no-agent, not both')
  const agent = values.agent === true ? true : values['no-agent'] === true ? false : undefined
  return {
    directory: positionals[0],
    name: values.name,
    host: host as Host | undefined,
    agent,
    install: values.install === true,
    yes: values.yes === true,
    help: values.help === true,
    version: values.version === true,
  }
}

const OPTIONS = {
  name: { type: 'string' },
  host: { type: 'string' },
  agent: { type: 'boolean' },
  'no-agent': { type: 'boolean' },
  install: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const

export const HELP = `create-aimbrace - scaffold a Cordis app

Usage:
  create-aimbrace [directory] [options]

Options:
  --host <hono|fastify>   the HTTP host (asked when not given)
  --agent / --no-agent    include the offline agent starter (asked when not given)
  --name <name>           the project name (default: the directory name)
  --install               run pnpm install after copying
  -y, --yes               accept defaults for anything not given (hono, no agent)
  -h, --help              show this help
  -v, --version           show the version

Examples:
  create-aimbrace my-app
  create-aimbrace my-agent --host fastify --agent --yes
`
