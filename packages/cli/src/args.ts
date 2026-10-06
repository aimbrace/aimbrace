/** Options understood before the command name is looked at. */
export interface GlobalOptions {
  config: string | undefined
  cwd: string | undefined
  debug: boolean
  help: boolean
  version: boolean
  /** Everything else, in order: the command name first. */
  rest: string[]
}

const VALUE_OPTIONS: Record<string, 'config' | 'cwd'> = {
  '--config': 'config',
  '-c': 'config',
  '--cwd': 'cwd',
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

/** Pull the global options out of `argv`, leaving the rest untouched. Arguments after `--` are never inspected. */
export function extractGlobals(argv: readonly string[]): GlobalOptions {
  const result: GlobalOptions = {
    config: undefined,
    cwd: undefined,
    debug: false,
    help: false,
    version: false,
    rest: [],
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string
    if (arg === '--') {
      result.rest.push(...argv.slice(index))
      break
    }
    const equals = arg.indexOf('=')
    const flag = arg.startsWith('--') && equals !== -1 ? arg.slice(0, equals) : arg
    const target = VALUE_OPTIONS[flag]
    if (target) {
      const inline = flag !== arg ? arg.slice(equals + 1) : undefined
      const value = inline ?? argv[++index]
      if (value === undefined || value === '') throw new UsageError(`${flag} needs a value.`)
      result[target] = value
    } else if (arg === '--debug') result.debug = true
    else if (arg === '--help' || arg === '-h') result.help = true
    else if (arg === '--version' || arg === '-v') result.version = true
    else result.rest.push(arg)
  }
  return result
}
