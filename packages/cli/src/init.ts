import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { Io } from './io.ts'
import { copyTemplate, isValidName, nameFrom, TargetNotEmptyError } from './project.ts'
import { templateDir, templateFor } from './templates.ts'

/** A command line mistake. The CLI prints it with the help text and exits 2. */
export class UsageError extends Error {
  override name = 'UsageError'
}

/** What `init` was asked for. Anything left undefined is asked for on a terminal, or defaulted. */
export interface InitOptions {
  directory: string | undefined
  name: string | undefined
  agent: boolean | undefined
  install: boolean | undefined
  yes: boolean
}

const parse = (argv: readonly string[]) =>
  parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      name: { type: 'string' },
      agent: { type: 'boolean' },
      'no-agent': { type: 'boolean' },
      install: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
  })

/** Parse `init [dir] [--agent|--no-agent] [--name n] [--install] [-y]`. */
export function parseInitOptions(argv: readonly string[]): InitOptions {
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(argv)
  } catch (error) {
    throw new UsageError((error as Error).message)
  }
  const { values, positionals } = parsed
  if (positionals.length > 1) throw new UsageError('init takes at most one directory')
  if (values.agent && values['no-agent']) {
    throw new UsageError('use --agent or --no-agent, not both')
  }
  return {
    directory: positionals[0],
    name: values.name,
    agent: values.agent ? true : values['no-agent'] ? false : undefined,
    install: values.install,
    yes: values.yes === true,
  }
}

const yes = (answer: string) => ['y', 'yes'].includes(answer.trim().toLowerCase())

/** Scaffold a Cordis app. Returns the exit code: 0 done, 1 refused or failed. Never overwrites anything. */
export async function init(options: InitOptions, io: Io): Promise<number> {
  const relative = options.directory ?? '.'
  const directory = resolve(io.cwd, relative)
  const ask = options.yes ? undefined : io.ask

  let name = options.name ?? nameFrom(directory)
  if (options.name === undefined && ask) name = ask(`Project name (${name}):`).trim() || name
  if (!isValidName(name)) {
    throw new UsageError(
      `"${name}" is not a valid project name (lower case letters, digits and dashes, starting with a letter)`,
    )
  }
  const agent = options.agent ?? (ask ? yes(ask('Include the offline agent? (y/N)')) : false)
  const install = options.install ??
    (ask ? yes(ask('Fetch dependencies with deno install now? (y/N)')) : false)

  const template = templateFor(agent)
  let files: string[]
  try {
    files = await copyTemplate(templateDir(template), directory, name)
  } catch (error) {
    if (!(error instanceof TargetNotEmptyError)) throw error
    io.stderr(`error: ${error.message}\n`)
    return 1
  }
  io.stdout(`created ${name} (${template}) in ${directory}: ${files.length} files\n`)

  if (install && (await io.install(directory)) !== 0) {
    io.stderr('error: deno install failed; run it yourself in the new directory\n')
    return 1
  }
  const steps = [
    relative === '.' ? '' : `  cd ${relative}\n`,
    '  deno task dev\n  deno task test\n',
  ]
  io.stdout(`\nNext:\n${steps.join('')}`)
  return 0
}
