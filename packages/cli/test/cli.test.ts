import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  type Io,
  nameFrom,
  parseInitOptions,
  runCli,
  TEMPLATES,
  templatesRoot,
  UsageError,
  VERSION,
} from '../src/index'

const scratch = mkdtempSync(join(tmpdir(), 'aimbrace-cli-test-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** A test Io: captures output, answers prompts from a list, and records install calls. */
function fakeIo(options: { answers?: string[]; installCode?: number } = {}) {
  const out: string[] = []
  const err: string[] = []
  const installed: string[] = []
  const answers = options.answers ? [...options.answers] : undefined
  const io: Io = {
    stdout: { write: (text: string) => out.push(text) },
    stderr: { write: (text: string) => err.push(text) },
    cwd: scratch,
    ask: answers ? async () => answers.shift() ?? '' : undefined,
    install: async (directory) => {
      installed.push(directory)
      return options.installCode ?? 0
    },
  }
  return { io, out: () => out.join(''), err: () => err.join(''), installed }
}

const manifest = (dir: string) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

describe('templates', () => {
  it('are exactly app and agent', () => {
    expect(readdirSync(templatesRoot()).sort()).toEqual([...TEMPLATES].sort())
  })

  it.each(TEMPLATES)('%s depends on cordis only', (template) => {
    const deps = manifest(join(templatesRoot(), template)).dependencies
    expect(Object.keys(deps)).toEqual(['cordis'])
  })
})

describe('command line', () => {
  it('prints help and version', async () => {
    const help = fakeIo()
    expect(await runCli(['--help'], help.io)).toBe(0)
    expect(help.out()).toContain('aimbrace init [dir]')
    const version = fakeIo()
    expect(await runCli(['--version'], version.io)).toBe(0)
    expect(version.out()).toBe(`${VERSION}\n`)
  })

  it('exits 2 with help on no command or an unknown one', async () => {
    expect(await runCli([], fakeIo().io)).toBe(2)
    const unknown = fakeIo()
    expect(await runCli(['graph'], unknown.io)).toBe(2)
    expect(unknown.err()).toContain('unknown command "graph"')
  })

  it('parses init flags and rejects bad ones', () => {
    expect(parseInitOptions(['shop', '--agent', '--name', 'my-shop', '-y'])).toEqual({
      directory: 'shop',
      name: 'my-shop',
      agent: true,
      install: undefined,
      yes: true,
    })
    expect(parseInitOptions(['--no-agent']).agent).toBe(false)
    expect(() => parseInitOptions(['--agent', '--no-agent'])).toThrow(/not both/)
    expect(() => parseInitOptions(['a', 'b'])).toThrow(UsageError)
    expect(() => parseInitOptions(['--host', 'hono'])).toThrow(UsageError)
  })

  it('derives a valid name from a directory', () => {
    expect(nameFrom('/tmp/My Cool_App')).toBe('my-cool-app')
    expect(nameFrom('/tmp/123')).toBe('my-app')
  })
})

describe('init', () => {
  it('copies the app template with the name filled in', async () => {
    const session = fakeIo()
    expect(await runCli(['init', 'plain', '-y'], session.io)).toBe(0)
    const dir = join(scratch, 'plain')
    expect(manifest(dir).name).toBe('plain')
    expect(readFileSync(join(dir, 'src/plugins/routes.mjs'), 'utf8')).toContain("app: 'plain'")
    expect(existsSync(join(dir, 'src/plugins/agent.mjs'))).toBe(false)
    expect(session.out()).toContain('created plain (app)')
    expect(session.out()).toContain('cd plain\n  pnpm install\n  pnpm dev')
    expect(session.installed).toEqual([])
  })

  it('copies the agent template when asked on the terminal', async () => {
    const session = fakeIo({ answers: ['', 'y', 'n'] })
    expect(await runCli(['init', 'asked'], session.io)).toBe(0)
    expect(existsSync(join(scratch, 'asked/src/plugins/agent.mjs'))).toBe(true)
    expect(session.out()).toContain('created asked (agent)')
  })

  it('refuses a non-empty directory and changes nothing', async () => {
    const dir = join(scratch, 'full')
    mkdirSync(dir)
    writeFileSync(join(dir, 'notes.md'), 'mine')
    const session = fakeIo()
    expect(await runCli(['init', 'full', '-y'], session.io)).toBe(1)
    expect(session.err()).toContain('refusing to write')
    expect(readdirSync(dir)).toEqual(['notes.md'])
  })

  it('rejects an invalid name before writing', async () => {
    const session = fakeIo()
    expect(await runCli(['init', 'bad', '--name', 'Bad Name', '-y'], session.io)).toBe(2)
    expect(existsSync(join(scratch, 'bad'))).toBe(false)
  })

  it('installs when asked and reports a failed install', async () => {
    const ok = fakeIo()
    expect(await runCli(['init', 'installed', '-y', '--install'], ok.io)).toBe(0)
    expect(ok.installed).toEqual([join(scratch, 'installed')])
    expect(ok.out()).not.toContain('pnpm install')
    const failing = fakeIo({ installCode: 1 })
    expect(await runCli(['init', 'install-fails', '-y', '--install'], failing.io)).toBe(1)
    expect(failing.err()).toContain('pnpm install failed')
  })
})
