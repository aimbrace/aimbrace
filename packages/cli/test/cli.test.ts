import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { Commands, commandsPlugin, RESERVED_COMMANDS, runCli, VERSION } from '../src'

const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url))
const app = join(fixtures, 'app')
const scratch = mkdtempSync(join(tmpdir(), 'aimbrace-cli-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function capture(options: { signal?: AbortSignal; cwd?: string } = {}) {
  let out = ''
  let err = ''
  return {
    io: {
      stdout: {
        write: (text: string) => {
          out += text
        },
      },
      stderr: {
        write: (text: string) => {
          err += text
        },
      },
      cwd: options.cwd ?? scratch,
      ...(options.signal ? { signal: options.signal } : {}),
    },
    out: () => out,
    err: () => err,
  }
}

async function cli(args: string[], options: { signal?: AbortSignal; cwd?: string } = {}) {
  const output = capture(options)
  const code = await runCli(args, output.io)
  return { code, out: output.out(), err: output.err() }
}

describe('help and version', () => {
  it('prints help with exit 0 when asked and exit 2 when no command is given', async () => {
    const asked = await cli(['--help'])
    expect(asked.code).toBe(0)
    expect(asked.out).toContain('Usage: aimbrace')
    expect(asked.out).toContain('graph [--format')
    expect((await cli(['help'])).code).toBe(0)
    const bare = await cli([])
    expect(bare.code).toBe(2)
    expect(bare.out).toContain('Commands:')
  })

  it('prints the version', async () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
    for (const flag of [['--version'], ['-v'], ['version']]) {
      const result = await cli(flag)
      expect(result.out).toBe(`${VERSION}\n`)
    }
  })

  it('reports usage errors with exit 2', async () => {
    expect((await cli(['--config'])).code).toBe(2)
    const unknownFormat = await cli(['graph', '--format', 'nope', '--cwd', app])
    expect(unknownFormat.code).toBe(2)
    expect(unknownFormat.err).toContain('Unknown format "nope"')
    const unknownOption = await cli(['graph', '--wat', '--cwd', app])
    expect(unknownOption.code).toBe(2)
  })
})

describe('graph', () => {
  it.each([
    ['text', /Plugin graph: 2 plugins, order greeter -> fixture-commands/],
    ['mermaid', /^flowchart TD/],
    ['dot', /^digraph aimbrace/],
    ['json', /"order": \[/],
  ])('prints the %s format', async (format, pattern) => {
    const result = await cli(['graph', '--format', format, '--cwd', app])
    expect(result.code).toBe(0)
    expect(result.out).toMatch(pattern)
  })

  it('defaults to text, accepts -c and --config=, and finds the config upwards', async () => {
    expect((await cli(['graph', '--cwd', app])).out).toContain('Plugin graph')
    expect((await cli(['graph', '-c', join(app, 'aimbrace.config.mjs')])).code).toBe(0)
    expect((await cli(['graph', `--config=${join(app, 'aimbrace.config.mjs')}`])).code).toBe(0)
    expect((await cli(['graph', '--cwd', join(app, 'plugins')])).code).toBe(0)
  })

  it('prints an invalid graph and exits 1 with the problems on stderr', async () => {
    const result = await cli(['graph', '--cwd', join(fixtures, 'invalid')])
    expect(result.code).toBe(1)
    expect(result.out).toContain('Plugin graph')
    expect(result.err).toContain('requires service "ghost"')
  })

  it('explains a missing config', async () => {
    const empty = mkdtempSync(join(scratch, 'empty-'))
    const result = await cli(['graph', '--config', join(empty, 'none.json')])
    expect(result.code).toBe(1)
    expect(result.err).toContain('error:')
  })
})

describe('check', () => {
  it('passes a valid project', async () => {
    const result = await cli(['check', '--cwd', app])
    expect(result).toMatchObject({ code: 0, out: 'OK: 2 plugins (greeter -> fixture-commands)\n' })
  })

  it('fails on a graph problem', async () => {
    const result = await cli(['check', '--cwd', join(fixtures, 'invalid')])
    expect(result.code).toBe(1)
    expect(result.err).toContain('requires service "ghost"')
    expect(result.err).toContain('1 problem found.')
  })

  it('reports config problems and never runs setup', async () => {
    const result = await cli(['check', '--cwd', join(fixtures, 'badconfig')])
    expect(result.code).toBe(1)
    expect(result.err).toContain('expected a number (at port)')
    expect(result.err).not.toContain('setup must not run')
  })
})

describe('run', () => {
  it('starts, lists plugins, and stops with --once', async () => {
    const result = await cli(['run', '--once', '--cwd', app])
    expect(result.code).toBe(0)
    expect(result.out).toContain('Started "cli-fixture" with 2 plugins')
    expect(result.out).toContain('  greeter running')
    expect(result.out).toContain('Stopped')
  })

  it('prints the full snapshot with --inspect', async () => {
    const result = await cli(['run', '--once', '--inspect', '--cwd', app])
    expect(result.out).toContain('"state": "running"')
  })

  it('waits for the signal, then stops', async () => {
    const controller = new AbortController()
    const running = cli(['run', '--cwd', app], { signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 100))
    controller.abort()
    const result = await running
    expect(result.code).toBe(0)
    expect(result.out.trimEnd().endsWith('Stopped')).toBe(true)
  })

  it('fails with the error chain when the app cannot start', async () => {
    const result = await cli(['run', '--once', '--cwd', join(fixtures, 'failing')])
    expect(result.code).toBe(1)
    expect(result.err).toContain(
      'error: Plugin "breaks" failed during install: cannot connect [E_PLUGIN]',
    )
    expect(result.err).toContain('caused by: cannot connect')
    expect(result.err).not.toContain('at ')
    const debug = await cli(['run', '--once', '--debug', '--cwd', join(fixtures, 'failing')])
    expect(debug.err).toContain('at ')
  })
})

describe('plugin commands', () => {
  it('lists them', async () => {
    const result = await cli(['commands', '--cwd', app])
    expect(result.code).toBe(0)
    expect(result.out).toContain('greet <name> [--loud]  Greet someone')
    expect(result.out).toContain('fail')
  })

  it('runs one inside a scope that can read app services, passing arguments and options', async () => {
    expect(await cli(['greet', 'ann', '--cwd', app])).toMatchObject({
      code: 0,
      out: 'Hello, ann!\n',
    })
    expect(await cli(['greet', 'ann', '--loud', '--cwd', app])).toMatchObject({
      code: 0,
      out: 'HELLO, ANN!\n',
    })
    expect(await cli(['--cwd', app, 'greet', '-l', 'bo'])).toMatchObject({ out: 'HELLO, BO!\n' })
  })

  it('uses the command exit code and reports a crash', async () => {
    expect((await cli(['fail', '--cwd', app])).code).toBe(3)
    const crash = await cli(['crash', '--cwd', app])
    expect(crash.code).toBe(1)
    expect(crash.err).toContain('command exploded')
    expect((await cli(['greet', '--cwd', app])).code).toBe(2)
  })

  it('rejects unknown commands and unknown command options with helpful output', async () => {
    const unknown = await cli(['nope', '--cwd', app])
    expect(unknown.code).toBe(2)
    expect(unknown.err).toContain('unknown command "nope". Plugin commands: greet, fail, crash.')
    expect((await cli(['greet', 'x', '--wat', '--cwd', app])).code).toBe(2)
  })

  it('refuses plugin commands that reuse a built-in name or an invalid name', () => {
    for (const name of RESERVED_COMMANDS) {
      expect(() => commandsPlugin('x', [{ name, run: () => {} }])).toThrow(/built-in command/)
    }
    expect(() => commandsPlugin('x', [{ name: 'Bad Name', run: () => {} }])).toThrow(
      /must be lower case/,
    )
    expect(Commands.name).toBe('cli.commands')
  })
})

describe('plugins and init', () => {
  it('lists installed plugin packages', async () => {
    const project = join(scratch, 'with-plugins')
    mkdirSync(join(project, 'node_modules', 'my-plugin'), { recursive: true })
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({ name: 'p', dependencies: { 'my-plugin': '1.0.0' } }),
    )
    writeFileSync(
      join(project, 'node_modules', 'my-plugin', 'package.json'),
      JSON.stringify({
        name: 'my-plugin',
        version: '1.2.3',
        description: 'Does things',
        aimbrace: { plugin: './x.js' },
      }),
    )
    const result = await cli(['plugins', '--cwd', project])
    expect(result.out).toContain('my-plugin  1.2.3')
    expect(result.out).toContain('Does things')
    const none = await cli(['plugins', '--cwd', mkdtempSync(join(scratch, 'none-'))])
    expect(none.out).toContain('No installed plugins found')
  })

  it('scaffolds a project and refuses to overwrite it', async () => {
    const project = join(scratch, 'My New App')
    const first = await cli(['init', project, '--yes'])
    expect(first.code).toBe(0)
    expect(first.out).toContain('created my-new-app (hono)')
    expect(existsSync(join(project, 'src', 'app.mjs'))).toBe(true)
    expect(JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).name).toBe('my-new-app')
    const second = await cli(['init', project, '--yes'])
    expect(second.code).toBe(1)
    expect(second.err).toContain('refusing to write')
    expect((await cli(['init', 'a', 'b'])).code).toBe(2)
  })
})

describe('the built bin', () => {
  const bin = fileURLToPath(new URL('../bin/aimbrace.js', import.meta.url))
  const built = existsSync(fileURLToPath(new URL('../dist/index.js', import.meta.url)))

  it.skipIf(!built)('runs as a real process and sets the exit code', () => {
    const graph = execFileSync(process.execPath, [bin, 'graph', '--cwd', app], { encoding: 'utf8' })
    expect(graph).toContain('Plugin graph: 2 plugins')
    const failed = spawnSync(process.execPath, [bin, 'check', '--cwd', join(fixtures, 'invalid')], {
      encoding: 'utf8',
    })
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain('requires service "ghost"')
    const custom = execFileSync(process.execPath, [bin, 'greet', 'zed', '--cwd', app], {
      encoding: 'utf8',
    })
    expect(custom).toBe('Hello, zed!\n')
  })
})
