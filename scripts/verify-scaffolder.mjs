#!/usr/bin/env node
/**
 * Prove each template works the way a user runs it:
 *
 *  1. build the CLI and run `aimbrace init` for real into an empty temp directory
 *  2. a second `init` into the same directory must refuse and change nothing
 *  3. the generated package.json must depend on `cordis` and nothing else
 *  4. install, run the project's own tests, boot it with `pnpm start`, request its routes, stop it with SIGINT
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
    if (!existsSync(join(dir, 'src', 'app.mjs'))) fail(`${template}: init wrote no app`)

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
    if (deps.join(',') !== 'cordis')
      fail(`${template}: runtime dependencies are ${deps.join(', ')}, expected cordis only`)
    log(`${template}: scaffolded, refusal ok, depends on cordis only`)

    capture('pnpm', ['install'], { cwd: dir })
    capture('pnpm', ['test'], { cwd: dir })
    log(`${template}: installed, project tests pass`)

    const child = spawn('pnpm', ['start'], {
      cwd: dir,
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    try {
      const url = await waitForUrl(child)
      const home = await json(await fetch(`${url}/`), `${template}: GET /`)
      if (home.app !== name || home.ok !== true)
        fail(`${template}: GET / answered ${JSON.stringify(home)}`)
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
  }
  log('OK')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
