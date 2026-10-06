#!/usr/bin/env node
/**
 * Prove every template works the way a user will run it:
 *
 *  1. build the create-aimbrace CLI and run it (for real) to scaffold each of the four templates into an empty temp dir
 *  2. refuse rules: a second run into the same directory must fail and change nothing
 *  3. no generated package.json may depend on an @aimbrace/* package, and there may be at most four templates
 *  4. install, run the template's own tests, boot it with `pnpm start`, request its routes, and stop it cleanly
 *  5. the two hosts must give the same answer for the same route
 *
 * Needs the network for the install step. Fails loudly on the first problem.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const cliDir = join(root, 'packages', 'create')
const cli = join(cliDir, 'bin', 'create-aimbrace.js')
const scratch = mkdtempSync(join(tmpdir(), 'verify-scaffolder-'))
const EXPECTED = ['hono', 'hono-agent', 'fastify', 'fastify-agent']
const TEMPLATE_CAP = 4

const log = (message) => console.log(`verify-scaffolder: ${message}`)
const fail = (message) => {
  throw new Error(`verify-scaffolder: ${message}`)
}

function capture(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
}

async function waitForUrl(child, timeoutMs = 60_000) {
  return new Promise((done, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`no listening line within ${timeoutMs}ms:\n${output}`)), timeoutMs)
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
  const exit = new Promise((done) => child.once('exit', (code, signal) => done({ code, signal })))
  child.kill('SIGINT')
  const timeout = new Promise((done) => setTimeout(() => done('timeout'), 10_000))
  const result = await Promise.race([exit, timeout])
  if (result === 'timeout') {
    child.kill('SIGKILL')
    fail('the app did not stop within 10s of SIGINT')
  }
  if (result.code !== 0 && result.code !== null) fail(`the app exited with ${result.code} on SIGINT`)
}

function manifestOf(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
}

try {
  // 1. build the CLI from source
  log('building create-aimbrace')
  capture('pnpm', ['run', 'build'], { cwd: cliDir })
  if (!existsSync(cli)) fail(`CLI entry not found at ${cli}`)

  // 3a. template count cap, checked before anything else
  const templates = readdirSync(join(root, 'templates')).filter((name) => statSync(join(root, 'templates', name)).isDirectory())
  if (templates.length > TEMPLATE_CAP) fail(`${templates.length} templates, the cap is ${TEMPLATE_CAP}`)
  for (const name of EXPECTED) if (!templates.includes(name)) fail(`template "${name}" is missing`)
  log(`${templates.length} templates within the cap of ${TEMPLATE_CAP}`)

  const answers = {
    hono: ['--host', 'hono'],
    'hono-agent': ['--host', 'hono', '--agent'],
    fastify: ['--host', 'fastify'],
    'fastify-agent': ['--host', 'fastify', '--agent'],
  }
  const responses = {}

  for (const id of EXPECTED) {
    const dir = join(scratch, id)
    // 1. scaffold with the real CLI, non-interactively
    capture(process.execPath, [cli, dir, '--name', `verify-${id}`, '--yes', ...answers[id]])
    if (!existsSync(join(dir, 'src', 'app.mjs'))) fail(`${id}: scaffold wrote no app`)

    // 2. the same command into the same directory must refuse
    const again = await new Promise((done) => {
      const child = spawn(process.execPath, [cli, dir, '--yes', ...answers[id]], { stdio: ['ignore', 'pipe', 'pipe'] })
      let err = ''
      child.stderr.on('data', (chunk) => (err += chunk))
      child.on('exit', (code) => done({ code, err }))
    })
    if (again.code === 0) fail(`${id}: a second scaffold into the same directory succeeded`)
    if (!again.err.includes('refusing to write')) fail(`${id}: the refusal message is missing: ${again.err}`)

    // 3b. zero @aimbrace dependencies in what a user receives
    const manifest = manifestOf(dir)
    const deps = { ...manifest.dependencies, ...manifest.devDependencies }
    const framework = Object.keys(deps).filter((name) => name.startsWith('@aimbrace/'))
    if (framework.length > 0) fail(`${id}: depends on framework packages ${framework.join(', ')}`)
    log(`${id}: scaffolded, refusal ok, no @aimbrace/* dependency`)

    // 4. install, run the template's own tests
    capture('pnpm', ['install'], { cwd: dir, stdio: 'pipe' })
    capture('pnpm', ['test'], { cwd: dir })
    log(`${id}: installed, template tests pass`)

    // 4. boot it the way a user does and request its routes
    const child = spawn('pnpm', ['start'], { cwd: dir, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      const url = await waitForUrl(child)
      const home = await fetch(`${url}/`)
      if (home.status !== 200) fail(`${id}: GET / returned ${home.status}`)
      const body = await home.json()
      if (body.ok !== true) fail(`${id}: GET / body is ${JSON.stringify(body)}`)
      if (body.app !== `verify-${id}`) fail(`${id}: GET / names the app ${body.app}`)
      if ((await fetch(`${url}/health`)).status !== 200) fail(`${id}: GET /health is not 200`)
      responses[id] = { home: body }
      if (id.endsWith('-agent')) {
        const ask = await fetch(`${url}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'add 2 3' }) })
        if (ask.status !== 200) fail(`${id}: POST /ask returned ${ask.status}`)
        const answer = await ask.json()
        if (answer.output !== 'The answer is 5.') fail(`${id}: POST /ask answered ${JSON.stringify(answer)}`)
        responses[id].ask = answer
      }
      log(`${id}: served ${url} (GET / 200${id.endsWith('-agent') ? ', POST /ask 200' : ''})`)
    } finally {
      await stopCleanly(child)
    }
  }

  // 5. the two hosts agree
  const pairs = [
    ['hono', 'fastify'],
    ['hono-agent', 'fastify-agent'],
  ]
  for (const [a, b] of pairs) {
    const left = JSON.stringify({ ...responses[a].home, app: 'same' })
    const right = JSON.stringify({ ...responses[b].home, app: 'same' })
    if (left !== right) fail(`${a} and ${b} answer GET / differently: ${left} vs ${right}`)
    if (a.endsWith('-agent') && JSON.stringify(responses[a].ask) !== JSON.stringify(responses[b].ask)) {
      fail(`${a} and ${b} answer POST /ask differently`)
    }
  }
  log('both hosts answer identically')
  log('OK')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
