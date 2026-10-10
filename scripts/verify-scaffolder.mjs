#!/usr/bin/env node
/**
 * Prove each template works the way a user runs it:
 *
 *  1. build the CLI and run `aimbrace init` for real into an empty temp directory
 *  2. a second `init` into the same directory must refuse and change nothing
 *  3. the generated package.json depends at run time only on the named packages (constitution III)
 *  4. npm install, `npm run check` (types), `npm test`, boot it with `npm start` in a throwaway home, request its routes,
 *     stop it with SIGINT, and confirm its data stayed in that home
 *
 * Needs the network for the install step. Fails on the first problem.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const cliDir = join(root, 'packages', 'cli')
const cli = join(cliDir, 'bin', 'aimbrace.js')
const scratch = mkdtempSync(join(tmpdir(), 'verify-scaffolder-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const TEMPLATES = { app: ['--no-agent'], agent: ['--agent'] }

const log = (message) => console.log(`verify-scaffolder: ${message}`)
const fail = (message) => {
  throw new Error(`verify-scaffolder: ${message}`)
}

const capture = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })

function waitForUrl(child, timeoutMs = 60_000) {
  return new Promise((done, reject) => {
    let output = ''
    const timer = setTimeout(
      () => reject(new Error(`not listening after ${timeoutMs}ms:\n${output}`)),
      timeoutMs,
    )
    const onData = (chunk) => {
      output += chunk
      const match = /listening on (http:\/\/\S+)/.exec(output)
      if (match) {
        clearTimeout(timer)
        done(match[1])
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code) => reject(new Error(`exited early with ${code}:\n${output}`)))
  })
}

/**
 * Stop the app the way Ctrl+C in a terminal does: SIGINT to its whole process group (npm, the shell npm starts, and node). Signalling
 * npm alone is not enough on Linux, where /bin/sh (dash) does not pass the signal on to node. Windows has no process groups.
 */
const interrupt = (child, signal) => {
  if (process.platform === 'win32') child.kill(signal)
  else process.kill(-child.pid, signal)
}

async function stopCleanly(child) {
  const exited = new Promise((done) => child.once('exit', (code) => done(code)))
  interrupt(child, 'SIGINT')
  const code = await Promise.race([
    exited,
    new Promise((done) => setTimeout(() => done('timeout'), 10_000)),
  ])
  if (code === 'timeout') {
    interrupt(child, 'SIGKILL')
    fail('the app did not stop within 10s of SIGINT')
  }
  if (code !== 0 && code !== null) fail(`the app exited with ${code} on SIGINT`)
}

async function json(response, what) {
  if (response.status !== 200) fail(`${what} returned ${response.status}`)
  return response.json()
}

try {
  log('building the aimbrace CLI')
  capture('pnpm', ['run', 'build'], { cwd: cliDir })
  const present = readdirSync(join(cliDir, 'templates')).sort()
  if (present.join(',') !== Object.keys(TEMPLATES).sort().join(','))
    fail(`unexpected templates: ${present.join(', ')}`)

  for (const [template, flags] of Object.entries(TEMPLATES)) {
    const dir = join(scratch, template)
    const name = `verify-${template}`
    capture(process.execPath, [cli, 'init', dir, '--name', name, '--yes', ...flags])
    if (!existsSync(join(dir, 'src', 'app.ts'))) fail(`${template}: init wrote no app`)

    const again = spawn(process.execPath, [cli, 'init', dir, '--yes', ...flags], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let refusal = ''
    again.stderr.on('data', (chunk) => (refusal += chunk))
    const code = await new Promise((done) => again.on('exit', done))
    if (code === 0 || !refusal.includes('refusing to write'))
      fail(`${template}: a second init did not refuse`)

    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const deps = Object.keys(manifest.dependencies ?? {})
    const allowed = new Set(['@deepseek-ai/cordis', '@deepseek-ai/schemastery', 'yaml'])
    if (!deps.includes('@deepseek-ai/cordis') || deps.some((name) => !allowed.has(name)))
      fail(
        `${template}: runtime dependencies are ${deps.join(', ')}; allowed: ${[...allowed].join(', ')}`,
      )
    log(`${template}: scaffolded, refusal ok, runtime dependencies ${deps.join(', ')}`)

    capture(npm, ['install', '--no-audit', '--no-fund'], { cwd: dir })
    capture(npm, ['run', 'check'], { cwd: dir })
    capture(npm, ['test'], { cwd: dir })
    capture(npm, ['run', 'lock'], { cwd: dir })
    const locked = JSON.parse(readFileSync(join(dir, 'aimbrace.lock.json'), 'utf8'))
    if (!/^sha256:[0-9a-f]{64}$/.test(locked.manifest?.digest ?? '') || !locked.sources?.manifest) {
      fail(`${template}: npm run lock wrote ${JSON.stringify(locked).slice(0, 200)}`)
    }
    log(`${template}: installed, project tests pass`)

    const home = mkdtempSync(join(tmpdir(), `verify-home-${template}-`))
    const start = () =>
      spawn(npm, ['start'], {
        cwd: dir,
        env: { ...process.env, AIMBRACE_HOME: home, AIMBRACE_PORT: '0' },
        shell: process.platform === 'win32',
        // Its own process group, so stopCleanly can interrupt npm and everything it started together.
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    let child = start()
    try {
      let url = await waitForUrl(child)
      const index = await json(await fetch(`${url}/`), `${template}: GET /`)
      if (index.app !== name || index.ok !== true)
        fail(`${template}: GET / answered ${JSON.stringify(index)}`)
      await json(await fetch(`${url}/health`), `${template}: GET /health`)
      if (template === 'agent') {
        const ask = async (question) =>
          (
            await json(
              await fetch(`${url}/ask`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ question }),
              }),
              `agent: POST /ask "${question}"`,
            )
          ).output
        const hello = async () => {
          const response = await fetch(`${url}/hello`)
          return response.status === 200 ? (await response.json()).text : response.status
        }
        const expect = (actual, expected, what) => {
          if (actual !== expected)
            fail(
              `agent: ${what}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
            )
        }
        expect(await ask('add 2 3'), 'The answer is 5.', 'tool call')
        // The builder loop, against the app a user runs: the agent extends it while it serves.
        expect(await ask('create route hello /hello Hello'), 'hello: installed, active.', 'create')
        expect(await hello(), 'Hello', 'GET /hello after create')
        expect(await ask('update route hello /hello Bonjour'), 'hello: updated, active.', 'update')
        expect(await hello(), 'Bonjour', 'GET /hello after update')
        const refused = await ask('break plugin hello')
        if (!/Previous version restored: true/.test(refused))
          fail(`agent: broken update: ${refused}`)
        expect(await hello(), 'Bonjour', 'GET /hello after a broken update')
        await ask('update route hello /hello Bonjour')
        log(
          'agent: built, updated and protected a plugin live (create, update, broken update kept the old one)',
        )
        // The agent's code is the app's code: it type-checks with the app, and starts again after a restart.
        capture(npm, ['run', 'check'], { cwd: dir })
        await stopCleanly(child)
        child = start()
        url = await waitForUrl(child)
        expect(await hello(), 'Bonjour', 'GET /hello after a restart')
        const records = await json(await fetch(`${url}/tasks`), 'agent: GET /tasks')
        const runs = records.filter((record) => record.kind === 'agent-run')
        if (runs.length < 5 || records.some((record) => record.status === 'running')) {
          fail(
            `agent: task records after a restart: ${JSON.stringify(records.map((record) => [record.kind, record.status]))}`,
          )
        }
        // Untrusted code: the agent writes a tool, it runs in the sandbox, and a tool that reaches outside its folder is refused.
        expect(await ask('create tool triple 3'), 'triple: installed, active.', 'create tool')
        expect(await ask('run tool triple 14'), '{"n":42}', 'run tool')
        const spy = await ask('spy tool snoop')
        if (!/^Refused: its check failed: denied:/.test(spy))
          fail(`agent: the sandbox did not refuse the spy tool: ${spy}`)
        log(
          'agent: built a sandboxed tool and ran it; the sandbox refused a tool that read outside its folder',
        )
        // Internal to external: the agent packages what it built; a second app takes the package in and serves it.
        const packaged = await ask('package plugin hello')
        if (!packaged.startsWith('hello: packaged in ')) fail(`agent: package plugin: ${packaged}`)
        const other = join(scratch, 'other')
        capture(process.execPath, [
          cli,
          'init',
          other,
          '--name',
          'verify-other',
          '--yes',
          '--agent',
        ])
        capture(process.execPath, [
          cli,
          'add',
          join(dir, 'plugin-packages', 'hello'),
          '--dir',
          other,
        ])
        capture(npm, ['install', '--no-audit', '--no-fund'], { cwd: other })
        const otherHome = mkdtempSync(join(tmpdir(), 'verify-home-other-'))
        const otherChild = spawn(npm, ['start'], {
          cwd: other,
          env: { ...process.env, AIMBRACE_HOME: otherHome, AIMBRACE_PORT: '0' },
          shell: process.platform === 'win32',
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        try {
          const otherUrl = await waitForUrl(otherChild)
          const served = await json(await fetch(`${otherUrl}/hello`), 'other app: GET /hello')
          if (served.text !== 'Bonjour')
            fail(`other app: GET /hello answered ${JSON.stringify(served)}`)
        } finally {
          await stopCleanly(otherChild)
          rmSync(otherHome, { recursive: true, force: true })
        }
        log('agent: packaged its plugin; a second app added the package and serves it')
        expect(await ask('remove plugin hello'), 'hello: done.', 'remove')
        expect(await hello(), 404, 'GET /hello after remove')
        log('agent: the plugin type-checks with the app, survives a restart, and is removed live')
      }
      log(`${template}: served ${url}`)
    } finally {
      await stopCleanly(child)
    }
    // AIMBRACE_HOME pinned the data elsewhere, so the project folder must not have grown its own data folder.
    if (existsSync(join(dir, '.aimbrace')))
      fail(`${template}: wrote .aimbrace into the project despite AIMBRACE_HOME`)
    rmSync(home, { recursive: true, force: true })
    log(`${template}: stopped cleanly; data stayed in the pinned home`)
  }
  // npm run save in a real app: a first save commits; a file that holds a secret is refused and nothing is staged.
  const saved = join(scratch, 'app')
  for (const args of [
    ['init', '--quiet'],
    ['config', 'user.email', 'verify@example.com'],
    ['config', 'user.name', 'Verify'],
  ]) {
    capture('git', args, { cwd: saved })
  }
  const first = capture(npm, ['run', '--silent', 'save', '--', 'first save'], { cwd: saved })
  if (!/^saved [0-9a-f]{12}/m.test(first)) fail(`npm run save: ${first}`)
  writeFileSync(join(saved, 'leak.ts'), 'export const key = "AKIAABCDEFGHIJKLMNOP"\n')
  const leak = spawnSync(npm, ['run', '--silent', 'save', '--', 'leak'], {
    cwd: saved,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (leak.status === 0 || !/AWS access key/.test(leak.stderr))
    fail(`npm run save did not refuse a secret: ${leak.stdout}${leak.stderr}`)
  if (capture('git', ['diff', '--cached', '--name-only'], { cwd: saved }).trim() !== '')
    fail('npm run save left files staged after refusing')
  log('save: committed the app, then refused a file holding a secret with nothing left staged')
  // `aimbrace add` in a real app: the plugin, what it requires and its npm packages arrive, and the app still type-checks.
  const grown = join(scratch, 'grown')
  capture(process.execPath, [cli, 'init', grown, '--name', 'verify-grown', '--yes', '--no-agent'])
  capture(process.execPath, [cli, 'add', 'settings', '--dir', grown])
  const grownDeps = Object.keys(
    JSON.parse(readFileSync(join(grown, 'package.json'), 'utf8')).dependencies,
  )
  for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', 'yaml']) {
    if (!grownDeps.includes(name)) fail(`add settings: ${name} was not added to package.json`)
  }
  if (!existsSync(join(grown, 'src', 'plugins', 'settings', 'index.ts')))
    fail('add settings: the plugin was not copied')
  capture(npm, ['install', '--no-audit', '--no-fund'], { cwd: grown })
  capture(npm, ['run', 'check'], { cwd: grown })
  log('add settings: copied, dependencies added, installed, type-checks')
  log('OK')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
