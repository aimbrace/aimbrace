import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { join } from 'node:path'
import {
  type Io,
  nameFrom,
  parseInitOptions,
  runCli,
  templateDir,
  TEMPLATES,
  UsageError,
  VERSION,
} from '../src/main.ts'

const scratch = await Deno.makeTempDir({ prefix: 'aimbrace-cli-test-' })
globalThis.addEventListener('unload', () => Deno.removeSync(scratch, { recursive: true }))

/** A test Io: captures output, answers prompts from a list, records install calls. */
function fakeIo(options: { answers?: string[]; installCode?: number } = {}) {
  const out: string[] = []
  const err: string[] = []
  const installed: string[] = []
  const answers = options.answers ? [...options.answers] : undefined
  const io: Io = {
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
    cwd: scratch,
    ask: answers ? () => answers.shift() ?? '' : undefined,
    install: (directory) => {
      installed.push(directory)
      return Promise.resolve(options.installCode ?? 0)
    },
  }
  return { io, out: () => out.join(''), err: () => err.join(''), installed }
}

const exists = (path: string) => Deno.stat(path).then(() => true, () => false)
const readJson = async (path: string) => JSON.parse(await Deno.readTextFile(path))

/** Bare imports used by a project's source files. */
async function sourceImports(dir: URL): Promise<Set<string>> {
  const found = new Set<string>()
  for await (const entry of Deno.readDir(dir)) {
    const url = new URL(entry.isDirectory ? `${entry.name}/` : entry.name, dir)
    if (entry.isDirectory) { for (const name of await sourceImports(url)) found.add(name) }
    else {
      const text = await Deno.readTextFile(url)
      for (const [, name] of text.matchAll(/from '([^'.][^']*)'/g)) found.add(name as string)
    }
  }
  return found
}

Deno.test('templates are exactly app and agent', async () => {
  const names: string[] = []
  for await (const entry of Deno.readDir(new URL('../templates/', import.meta.url))) {
    names.push(entry.name)
  }
  assertEquals(names.sort(), [...TEMPLATES].sort())
})

for (const template of TEMPLATES) {
  Deno.test(`${template} imports @deepseek-ai/cordis and nothing else at runtime`, async () => {
    assertEquals([...await sourceImports(new URL('src/', templateDir(template)))], [
      '@deepseek-ai/cordis',
    ])
    const { imports } = await readJson(new URL('deno.json', templateDir(template)).pathname)
    assertEquals(Object.keys(imports).sort(), ['@deepseek-ai/cordis', '@std/assert'])
  })
}

Deno.test('prints help and version', async () => {
  const help = fakeIo()
  assertEquals(await runCli(['--help'], help.io), 0)
  assertStringIncludes(help.out(), 'aimbrace init [dir]')
  const version = fakeIo()
  assertEquals(await runCli(['--version'], version.io), 0)
  assertEquals(version.out(), `${VERSION}\n`)
})

Deno.test('exits 2 with help on no command or an unknown one', async () => {
  assertEquals(await runCli([], fakeIo().io), 2)
  const unknown = fakeIo()
  assertEquals(await runCli(['graph'], unknown.io), 2)
  assertStringIncludes(unknown.err(), 'unknown command "graph"')
})

Deno.test('parses init flags and rejects bad ones', () => {
  assertEquals(parseInitOptions(['shop', '--agent', '--name', 'my-shop', '-y']), {
    directory: 'shop',
    name: 'my-shop',
    agent: true,
    install: undefined,
    yes: true,
  })
  assertEquals(parseInitOptions(['--no-agent']).agent, false)
  assertThrows(() => parseInitOptions(['--agent', '--no-agent']), UsageError, 'not both')
  assertThrows(() => parseInitOptions(['a', 'b']), UsageError)
  assertThrows(() => parseInitOptions(['--host', 'hono']), UsageError)
})

Deno.test('derives a valid name from a directory', () => {
  assertEquals(nameFrom('/tmp/My Cool_App'), 'my-cool-app')
  assertEquals(nameFrom('/tmp/123'), 'my-app')
})

Deno.test('init copies the app template with the name filled in', async () => {
  const session = fakeIo()
  assertEquals(await runCli(['init', 'plain', '-y'], session.io), 0)
  const dir = join(scratch, 'plain')
  assertStringIncludes(
    await Deno.readTextFile(join(dir, 'src/plugins/routes.ts')),
    "APP_NAME = 'plain'",
  )
  assert(!(await exists(join(dir, 'src/plugins/agent.ts'))))
  assertStringIncludes(session.out(), 'created plain (app)')
  assertStringIncludes(session.out(), 'cd plain\n  deno task dev')
  assertEquals(session.installed, [])
})

Deno.test('init copies the agent template when asked on the terminal', async () => {
  const session = fakeIo({ answers: ['', 'y', 'n'] })
  assertEquals(await runCli(['init', 'asked'], session.io), 0)
  assert(await exists(join(scratch, 'asked/src/plugins/agent.ts')))
  assertStringIncludes(session.out(), 'created asked (agent)')
})

Deno.test('init refuses a non-empty directory and changes nothing', async () => {
  const dir = join(scratch, 'full')
  await Deno.mkdir(dir)
  await Deno.writeTextFile(join(dir, 'notes.md'), 'mine')
  const session = fakeIo()
  assertEquals(await runCli(['init', 'full', '-y'], session.io), 1)
  assertStringIncludes(session.err(), 'refusing to write')
  const entries = []
  for await (const entry of Deno.readDir(dir)) entries.push(entry.name)
  assertEquals(entries, ['notes.md'])
})

Deno.test('init rejects an invalid name before writing', async () => {
  const session = fakeIo()
  assertEquals(await runCli(['init', 'bad', '--name', 'Bad Name', '-y'], session.io), 2)
  assert(!(await exists(join(scratch, 'bad'))))
})

Deno.test('init installs when asked and reports a failed install', async () => {
  const ok = fakeIo()
  assertEquals(await runCli(['init', 'installed', '-y', '--install'], ok.io), 0)
  assertEquals(ok.installed, [join(scratch, 'installed')])
  const failing = fakeIo({ installCode: 1 })
  assertEquals(await runCli(['init', 'install-fails', '-y', '--install'], failing.io), 1)
  assertStringIncludes(failing.err(), 'deno install failed')
})
