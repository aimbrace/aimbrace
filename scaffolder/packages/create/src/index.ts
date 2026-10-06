import { resolve } from 'node:path'
import { parseOptions, HELP, UsageError } from './args'
import { copyTemplate, isValidName, TargetNotEmptyError } from './copy'
import { ask, defaults } from './prompts'
import { HOST_LABEL, templateDir, templateFor } from './templates'
import { VERSION } from './version'

export interface Io {
  stdout: { write(text: string): unknown }
  stderr: { write(text: string): unknown }
  /** True when the user can answer prompts. */
  interactive: boolean
  cwd: string
  /** Replace the install step in tests and CI. */
  install?: (directory: string) => Promise<number>
}

const processIo = (): Io => ({
  stdout: process.stdout,
  stderr: process.stderr,
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  cwd: process.cwd(),
})

/**
 * Scaffold a project. Returns the exit code: 0 done, 1 refused or failed, 2 usage error.
 * Writes nothing when the target is not free.
 */
export async function run(argv: readonly string[], io: Io = processIo()): Promise<number> {
  try {
    const options = parseOptions(argv)
    if (options.help) {
      io.stdout.write(HELP)
      return 0
    }
    if (options.version) {
      io.stdout.write(`${VERSION}\n`)
      return 0
    }
    const directory = resolve(io.cwd, options.directory ?? '.')
    const answers =
      io.interactive && !options.yes
        ? await ask(options, options.directory ?? '.')
        : defaults(options, options.directory ?? '.')
    if (!isValidName(answers.name)) {
      io.stderr.write(`error: "${answers.name}" is not a valid project name (lower case letters, digits and dashes, starting with a letter)\n`)
      return 2
    }
    const template = templateFor(answers.host, answers.agent)
    const source = templateDir(template)
    const copied = copyTemplate(source, directory, { name: answers.name, hostLabel: HOST_LABEL[answers.host] })
    io.stdout.write(`created ${answers.name} (${template}) in ${directory}: ${copied.length} files\n`)
    if (answers.install) {
      const code = io.install ? await io.install(directory) : await installWithPnpm(directory)
      if (code !== 0) {
        io.stderr.write('error: pnpm install failed; run it yourself in the new directory\n')
        return 1
      }
    }
    const relative = options.directory ?? '.'
    io.stdout.write(`\nNext:\n${relative === '.' ? '' : `  cd ${relative}\n`}${answers.install ? '' : '  pnpm install\n'}  pnpm dev\n  pnpm test\n`)
    return 0
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`error: ${error.message}\n\n${HELP}`)
      return 2
    }
    if (error instanceof TargetNotEmptyError) {
      io.stderr.write(`error: ${error.message}\n`)
      return 1
    }
    io.stderr.write(`error: ${(error as Error).message}\n`)
    return 1
  }
}

async function installWithPnpm(directory: string): Promise<number> {
  const { spawn } = await import('node:child_process')
  return new Promise((done) => {
    const child = spawn('pnpm', ['install'], { cwd: directory, stdio: 'inherit' })
    child.on('error', () => done(1))
    child.on('exit', (code) => done(code ?? 1))
  })
}

export { parseOptions, HELP, UsageError } from './args'
export { TEMPLATES, templateFor, type Host, type TemplateId } from './templates'
export { isValidName, nameFrom, TargetNotEmptyError, copyTemplate, assertTargetFree } from './copy'
export { VERSION } from './version'
