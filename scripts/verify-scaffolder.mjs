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
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
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

async function stopCleanly(child) {
  const exited = new Promise((done) => child.once('exit', (code) => done(code)))
  child.kill('SIGINT')
  const code = await Promise.race([
    exited,
    new Promise((done) => setTimeout(() => done('timeout'), 10_000)),
  ])
  if (code === 'timeout') {
    child.kill('SIGKILL')
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
    log(`${template}: installed, project tests pass`)

    const home = mkdtempSync(join(tmpdir(), `verify-home-${template}-`))
    const child = spawn(npm, ['start'], {
      cwd: dir,
      env: { ...process.env, AIMBRACE_HOME: home, AIMBRACE_PORT: '0' },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    try {
      const url = await waitForUrl(child)
      const index = await json(await fetch(`${url}/`), `${template}: GET /`)
      if (index.app !== name || index.ok !== true)
        fail(`${template}: GET / answered ${JSON.stringify(index)}`)
      await json(await fetch(`${url}/health`), `${template}: GET /health`)
      if (template === 'agent') {
        const answer = await json(
          await fetch(`${url}/ask`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ question: 'add 2 3' }),
          }),
          'agent: POST /ask',
        )
        if (answer.output !== 'The answer is 5.')
          fail(`agent: POST /ask answered ${JSON.stringify(answer)}`)
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
