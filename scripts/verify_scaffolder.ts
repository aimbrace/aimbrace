/**
 * Prove each template works the way a user runs it:
 *
 *  1. run `aimbrace init` for real into an empty temp directory
 *  2. a second `init` into the same directory must refuse and change nothing
 *  3. the project's source imports `@deepseek-ai/cordis` and nothing else
 *  4. `deno task check` (format, lint, types) and `deno task test` pass in the project
 *  5. `deno task start` boots it, its routes answer, and SIGINT stops it cleanly
 *
 * Needs the network the first time, to fetch Cordis into Deno's cache.
 */
import { join } from 'node:path'

const cli = new URL('../packages/cli/src/main.ts', import.meta.url).pathname
const scratch = await Deno.makeTempDir({ prefix: 'verify-scaffolder-' })
const TEMPLATES = { app: ['--no-agent'], agent: ['--agent'] } as const
const decoder = new TextDecoder()

const log = (message: string) => console.log(`verify-scaffolder: ${message}`)
function fail(message: string): never {
  throw new Error(`verify-scaffolder: ${message}`)
}

async function run(args: string[], cwd?: string) {
  const output = await new Deno.Command(Deno.execPath(), { args, cwd, stdin: 'null' }).output()
  return {
    code: output.code,
    out: decoder.decode(output.stdout) + decoder.decode(output.stderr),
  }
}

async function must(args: string[], cwd: string, what: string) {
  const result = await run(args, cwd)
  if (result.code !== 0) fail(`${what} failed:\n${result.out}`)
}

async function sourceImports(dir: string): Promise<Set<string>> {
  const found = new Set<string>()
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name)
    if (entry.isDirectory) { for (const name of await sourceImports(path)) found.add(name) }
    else {
      for (const [, name] of (await Deno.readTextFile(path)).matchAll(/from '([^'.][^']*)'/g)) {
        found.add(name as string)
      }
    }
  }
  return found
}

async function expectJson(response: Response, what: string) {
  if (response.status !== 200) fail(`${what} returned ${response.status}`)
  return await response.json()
}

/** Start the app, wait for its "listening on" line, and return its URL and a way to stop it. */
async function boot(dir: string) {
  const child = new Deno.Command(Deno.execPath(), {
    args: ['task', 'start'],
    cwd: dir,
    env: { PORT: '0' },
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader()
  let output = ''
  const deadline = setTimeout(() => child.kill('SIGKILL'), 60_000)
  while (true) {
    const { value, done } = await reader.read()
    if (done) fail(`the app exited before listening:\n${output}`)
    output += value
    const match = /listening on (http:\/\/\S+)/.exec(output)
    if (match) {
      clearTimeout(deadline)
      return {
        url: match[1] as string,
        async stop() {
          const killer = setTimeout(() => child.kill('SIGKILL'), 10_000)
          child.kill('SIGINT')
          const status = await child.status
          clearTimeout(killer)
          await reader.cancel()
          await child.stderr.cancel()
          if (!status.success) fail(`the app did not stop cleanly on SIGINT (code ${status.code})`)
        },
      }
    }
  }
}

try {
  for (const [template, flags] of Object.entries(TEMPLATES)) {
    const dir = join(scratch, template)
    const name = `verify-${template}`
    await must(['run', '-A', cli, 'init', dir, '--name', name, '-y', ...flags], scratch, 'init')

    const again = await run(['run', '-A', cli, 'init', dir, '-y', ...flags], scratch)
    if (again.code === 0 || !again.out.includes('refusing to write')) {
      fail(`${template}: a second init did not refuse`)
    }

    const imports = [...await sourceImports(join(dir, 'src'))]
    if (imports.join(',') !== '@deepseek-ai/cordis') {
      fail(`${template}: src imports ${imports.join(', ')}, expected @deepseek-ai/cordis only`)
    }
    log(`${template}: scaffolded, refusal ok, imports @deepseek-ai/cordis only`)

    await must(['task', 'check'], dir, `${template}: deno task check`)
    await must(['task', 'test'], dir, `${template}: deno task test`)
    log(`${template}: format, lint, types and tests pass`)

    const app = await boot(dir)
    try {
      const home = await expectJson(await fetch(`${app.url}/`), `${template}: GET /`)
      if (home.app !== name || home.ok !== true) {
        fail(`${template}: GET / answered ${JSON.stringify(home)}`)
      }
      await expectJson(await fetch(`${app.url}/health`), `${template}: GET /health`)
      if (template === 'agent') {
        const answer = await expectJson(
          await fetch(`${app.url}/ask`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ question: 'add 2 3' }),
          }),
          'agent: POST /ask',
        )
        if (answer.output !== 'The answer is 5.') {
          fail(`agent: POST /ask answered ${JSON.stringify(answer)}`)
        }
      }
      log(`${template}: served ${app.url}`)
    } finally {
      await app.stop()
    }
    log(`${template}: stopped cleanly on SIGINT`)
  }
  log('OK')
} finally {
  await Deno.remove(scratch, { recursive: true })
}
