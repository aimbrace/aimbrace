import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { UsageError } from '../args'
import type { Builtin } from './shared'

/** The host a template is built on. */
export type Host = 'hono' | 'fastify'

/** The four templates. Each is one host, with or without the offline agent. */
export const TEMPLATES = ['hono', 'hono-agent', 'fastify', 'fastify-agent'] as const
export type TemplateId = (typeof TEMPLATES)[number]

/** The template for a host and an agent choice. */
export function templateFor(host: Host, agent: boolean): TemplateId {
  return agent ? (`${host}-agent` as TemplateId) : host
}

/** Human label for a host, used in generated READMEs. */
export const HOST_LABEL: Record<Host, string> = { hono: 'Hono', fastify: 'Fastify' }

/** What `init` was asked for. Anything unset is asked for, or defaulted. */
export interface InitOptions {
  directory: string | undefined
  name: string | undefined
  host: Host | undefined
  agent: boolean | undefined
  install: boolean
  yes: boolean
}

const HOSTS: readonly Host[] = ['hono', 'fastify']

const OPTIONS = {
  name: { type: 'string' },
  host: { type: 'string' },
  agent: { type: 'boolean' },
  'no-agent': { type: 'boolean' },
  install: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
} as const

/** Parse the `init` flags. Positional: the target directory. */
export function parseInitOptions(argv: readonly string[]): InitOptions {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>
  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true })
  } catch (error) {
    throw new UsageError((error as Error).message)
  }
  const { values, positionals } = parsed
  if (positionals.length > 1) throw new UsageError('init takes at most one directory.')
  const host = values.host
  if (host !== undefined && !HOSTS.includes(host as Host))
    throw new UsageError(`--host must be "hono" or "fastify", got "${host}"`)
  if (values.agent === true && values['no-agent'] === true)
    throw new UsageError('use --agent or --no-agent, not both')
  return {
    directory: positionals[0],
    name: values.name,
    host: host as Host | undefined,
    agent: values.agent === true ? true : values['no-agent'] === true ? false : undefined,
    install: values.install === true,
    yes: values.yes === true,
  }
}

/** Thrown when the target directory exists and already has content. Nothing is written. */
export class TargetNotEmptyError extends Error {
  readonly target: string
  constructor(target: string) {
    super(
      `refusing to write into "${target}": the directory is not empty. Choose an empty or new directory.`,
    )
    this.name = 'TargetNotEmptyError'
    this.target = target
  }
}

/** Refuse a target that exists and has any entries. A missing target is fine (it is created). */
export function assertTargetFree(target: string): void {
  if (!existsSync(target)) return
  if (!statSync(target).isDirectory()) throw new TargetNotEmptyError(target)
  if (readdirSync(target).length > 0) throw new TargetNotEmptyError(target)
}

/** A project name npm accepts: lower case, digits and dashes, starting with a letter. */
export function isValidName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name) && name.length <= 214
}

/** A safe default name from a directory name. */
export function nameFrom(directory: string): string {
  const base = directory.split(/[\\/]/).filter(Boolean).pop() ?? 'my-app'
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
  return cleaned || 'my-app'
}

/**
 * Where the template folders live: the `templates/` folder of this package. The module sits at different depths in source
 * (`src/builtins/`) and in the build (`dist/`), so walk up until a folder named `templates` holds the hono template.
 */
export function templatesRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = join(dir, 'templates')
    if (existsSync(join(candidate, 'hono'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) throw new Error('the CLI cannot find its templates folder')
    dir = parent
  }
}

/** Absolute path of a template folder, or throws when it is missing. */
export function templateDir(id: TemplateId): string {
  const dir = join(templatesRoot(), id)
  if (!existsSync(dir)) throw new Error(`template "${id}" is missing (looked in ${dir})`)
  return dir
}

function substitute(text: string, name: string, hostLabel: string): string {
  return text.replaceAll('__APP_NAME__', name).replaceAll('__HOST_LABEL__', hostLabel)
}

/** Copy a template folder into `target`, replacing placeholders in text files. Throws before writing if the target is not free. */
export function copyTemplate(
  source: string,
  target: string,
  name: string,
  hostLabel: string,
): string[] {
  assertTargetFree(target)
  mkdirSync(target, { recursive: true })
  const written: string[] = []
  const walk = (from: string, to: string) => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const sourcePath = join(from, entry.name)
      const targetPath = join(to, entry.name)
      if (entry.isDirectory()) {
        mkdirSync(targetPath, { recursive: true })
        walk(sourcePath, targetPath)
        continue
      }
      const text = readFileSync(sourcePath, 'utf8')
      if (text.includes('__APP_NAME__') || text.includes('__HOST_LABEL__')) {
        writeFileSync(targetPath, substitute(text, name, hostLabel))
      } else {
        cpSync(sourcePath, targetPath)
      }
      written.push(targetPath)
    }
  }
  walk(source, target)
  return written.map((path) => path.slice(target.length + 1))
}

/** Ask for anything the flags did not give. Only called on an interactive terminal without `--yes`. */
async function ask(
  options: InitOptions,
  directory: string,
): Promise<{ name: string; host: Host; agent: boolean; install: boolean }> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    let name = options.name ?? nameFrom(directory)
    if (options.name === undefined) {
      const answer = (await rl.question(`Project name (${name}): `)).trim()
      if (answer) name = answer
    }
    let host = options.host
    if (host === undefined) {
      const answer = (await rl.question('Host - hono or fastify (hono): ')).trim().toLowerCase()
      host = answer === 'fastify' ? 'fastify' : 'hono'
    }
    let agent = options.agent
    if (agent === undefined) {
      const answer = (await rl.question('Include the offline agent starter? (y/N): '))
        .trim()
        .toLowerCase()
      agent = answer === 'y' || answer === 'yes'
    }
    let install = options.install
    if (!options.install) {
      const answer = (await rl.question('Install dependencies now with pnpm? (y/N): '))
        .trim()
        .toLowerCase()
      install = answer === 'y' || answer === 'yes'
    }
    return { name, host, agent, install }
  } finally {
    rl.close()
  }
}

/** `aimbrace init [dir] [--host hono|fastify] [--agent|--no-agent] [--name n] [-y]`: scaffold a Cordis app from a template. Never overwrites. */
export const initCommand: Builtin = async (ctx) => {
  const options = parseInitOptions(ctx.args)
  const directory = resolve(ctx.cwd, options.directory ?? '.')
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !options.yes
  const answers = interactive
    ? await ask(options, options.directory ?? '.')
    : {
        name: options.name ?? nameFrom(options.directory ?? '.'),
        host: options.host ?? 'hono',
        agent: options.agent ?? false,
        install: options.install,
      }
  if (!isValidName(answers.name)) {
    throw new UsageError(
      `"${answers.name}" is not a valid project name (lower case letters, digits and dashes, starting with a letter)`,
    )
  }
  const template = templateFor(answers.host, answers.agent)
  let copied: string[]
  try {
    copied = copyTemplate(templateDir(template), directory, answers.name, HOST_LABEL[answers.host])
  } catch (error) {
    if (error instanceof TargetNotEmptyError) {
      ctx.io.stderr.write(`error: ${error.message}\n`)
      return 1
    }
    throw error
  }
  ctx.io.stdout.write(
    `created ${answers.name} (${template}) in ${directory}: ${copied.length} files\n`,
  )
  if (answers.install) {
    const { spawn } = await import('node:child_process')
    const code = await new Promise<number>((done) => {
      const child = spawn('pnpm', ['install'], { cwd: directory, stdio: 'inherit' })
      child.on('error', () => done(1))
      child.on('exit', (exit) => done(exit ?? 1))
    })
    if (code !== 0) {
      ctx.io.stderr.write('error: pnpm install failed; run it yourself in the new directory\n')
      return 1
    }
  }
  const relative = options.directory ?? '.'
  ctx.io.stdout.write(
    `\nNext:\n${relative === '.' ? '' : `  cd ${relative}\n`}${answers.install ? '' : '  pnpm install\n'}  pnpm dev\n  pnpm test\n`,
  )
  return 0
}
