import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { UsageError } from '../args'
import type { Builtin } from './shared'

const CONFIG = (name: string) => `import { defineConfig } from '@aimbrace/loader'

export default defineConfig({
  name: ${JSON.stringify(name)},
  plugins: ['./plugins/hello.mjs'],
})
`

const HELLO = `import { definePlugin, service } from '@aimbrace/core'

export const Greeter = service('greeter')

export default definePlugin({
  id: 'hello',
  provides: [Greeter],
  setup(ctx) {
    ctx.provide(Greeter, { greet: (name) => \`Hello, \${name}!\` })
  },
  start() {
    console.log('hello plugin started')
  },
})
`

const PACKAGE = (name: string) =>
  `${JSON.stringify(
    {
      name,
      private: true,
      type: 'module',
      scripts: { start: 'aimbrace run', check: 'aimbrace check', graph: 'aimbrace graph' },
      dependencies: {
        '@aimbrace/cli': '^0.1.0',
        '@aimbrace/core': '^0.1.0',
        '@aimbrace/loader': '^0.1.0',
      },
    },
    null,
    2,
  )}\n`

/** `aimbrace init [dir]`: scaffold a config and a first plugin. Never overwrites a file. */
export const initCommand: Builtin = async (ctx) => {
  if (ctx.args.length > 1) throw new UsageError('init takes at most one directory.')
  const target = resolve(ctx.cwd, ctx.args[0] ?? '.')
  const name =
    basename(target)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-') || 'aimbrace-app'
  const files: Array<[string, string]> = [
    ['aimbrace.config.mjs', CONFIG(name)],
    ['plugins/hello.mjs', HELLO],
  ]
  if (!existsSync(join(target, 'package.json'))) files.push(['package.json', PACKAGE(name)])
  const clashes = files.filter(([file]) => existsSync(join(target, file))).map(([file]) => file)
  if (clashes.length > 0) {
    ctx.io.stderr.write(`error: refusing to overwrite ${clashes.join(', ')}\n`)
    return 1
  }
  for (const [file, content] of files) {
    const path = join(target, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
    ctx.io.stdout.write(`created ${join(ctx.args[0] ?? '.', file)}\n`)
  }
  ctx.io.stdout.write(
    '\nNext: install dependencies, then run "aimbrace check" and "aimbrace run".\n',
  )
  return 0
}
