#!/usr/bin/env node
/**
 * Prove the framework is usable the way a user will use it: pack every publishable package as npm would, install the
 * tarballs into an empty project (no workspace, no source aliases), scaffold an app with `aimbrace init`, and run it.
 *
 * Fails loudly on any step. Run after `pnpm run build`.
 */
import { execFileSync } from 'node:child_process'
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
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const scratch = mkdtempSync(join(tmpdir(), 'aimbrace-consumer-'))
const tarballs = join(scratch, 'tarballs')
mkdirSync(tarballs)

const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })

try {
  // 1. pack every publishable workspace package
  const packages = []
  for (const group of ['packages', 'plugins']) {
    for (const dir of readdirSync(join(root, group))) {
      const manifest = join(root, group, dir, 'package.json')
      if (!existsSync(manifest)) continue
      const json = JSON.parse(readFileSync(manifest, 'utf8'))
      if (json.private) continue
      packages.push({ name: json.name, dir: join(root, group, dir) })
    }
  }
  const overrides = {}
  for (const pkg of packages) {
    run('pnpm', ['pack', '--pack-destination', tarballs], { cwd: pkg.dir })
    const file = readdirSync(tarballs).find(
      (entry) =>
        entry.endsWith('.tgz') && entry.includes(pkg.name.replace('@', '').replace('/', '-')),
    )
    if (!file) throw new Error(`pack produced no tarball for ${pkg.name}`)
    overrides[pkg.name] = `file:${join(tarballs, file)}`
  }
  console.log(`packed ${packages.length} packages`)

  // 2. a consumer project that depends on the framework by name, like a user would
  const app = join(scratch, 'my-app')
  mkdirSync(app)
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify({
      name: 'my-app',
      private: true,
      type: 'module',
      dependencies: {
        '@aimbrace/core': '*',
        '@aimbrace/cli': '*',
        '@aimbrace/loader': '*',
        '@aimbrace/http': '*',
        '@aimbrace/hono': '*',
      },
    }),
  )
  // pnpm 12 reads overrides from pnpm-workspace.yaml (the package.json "pnpm" field is ignored)
  writeFileSync(
    join(app, 'pnpm-workspace.yaml'),
    `overrides:\n${Object.entries(overrides)
      .map(([name, target]) => `  "${name}": "${target}"`)
      .join('\n')}\n`,
  )
  run('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], {
    cwd: app,
    stdio: 'inherit',
  })

  // 3. scaffold with the installed CLI, then run the scaffolded app
  const cli = join(app, 'node_modules', '@aimbrace', 'cli', 'bin', 'aimbrace.js')
  run(process.execPath, [cli, 'init', 'hello'], { cwd: app })
  const project = join(app, 'hello')
  const check = run(process.execPath, [cli, 'check', '--cwd', project])
  if (!/^OK:/m.test(check)) throw new Error(`aimbrace check failed: ${check}`)
  console.log(check.trim())
  const graph = run(process.execPath, [cli, 'graph', '--cwd', project])
  if (!graph.includes('hello')) throw new Error('graph does not list the scaffolded plugin')
  const started = run(process.execPath, [cli, 'run', '--once', '--cwd', project])
  if (!started.includes('Started') || !started.includes('Stopped'))
    throw new Error(`aimbrace run failed: ${started}`)
  console.log(started.trim())

  // 4. a user's own plugin, written against the installed packages only
  writeFileSync(
    join(app, 'app.mjs'),
    `import { createApp, definePlugin, service } from '@aimbrace/core'
import { http, get, routesPlugin, HttpAddress, HttpDispatcher, text } from '@aimbrace/http'
import { honoHost } from '@aimbrace/hono'
const Greeter = service('greeter')
const greeter = definePlugin({ id: 'greeter', provides: [Greeter], setup: (ctx) => void ctx.provide(Greeter, (who) => 'hello ' + who) })
const app = createApp({ plugins: [http, honoHost({ port: 0 }), routesPlugin('web', [get('/hi/:who', (ctx) => text(ctx.scope.get(Greeter)(ctx.params.who)))]), greeter] })
await app.start()
const response = await fetch(app.get(HttpAddress).url + '/hi/ada')
const body = await response.text()
if (body !== 'hello ada') throw new Error('unexpected body: ' + body)
await app.stop()
if (!app.probe().clean) throw new Error('leaked')
console.log('own plugin served over Hono:', body)
`,
  )
  const own = run(process.execPath, [join(app, 'app.mjs')], { cwd: app })
  process.stdout.write(own)
  console.log('consumer verification OK')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
