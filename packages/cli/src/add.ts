import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { UsageError } from './init'
import type { Io } from './io'
import { closure, copyPlugin, type LibraryPlugin, readLibrary } from './library'
import { mergeDependencies } from './project'

export interface AddOptions {
  readonly names: readonly string[]
  readonly directory: string | undefined
}

/** Parse `add <plugin...> [--dir <app>]`. */
export function parseAddOptions(argv: readonly string[]): AddOptions {
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(argv)
  } catch (error) {
    throw new UsageError((error as Error).message)
  }
  if (parsed.positionals.length === 0)
    throw new UsageError('add needs at least one plugin name (see "aimbrace plugins")')
  return { names: parsed.positionals, directory: parsed.values.dir }
}

const parse = (argv: readonly string[]) =>
  parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: { dir: { type: 'string' } },
  })

const present = (appDir: string, name: string) => existsSync(join(appDir, 'src', 'plugins', name))

/**
 * Copy library plugins into an existing app, with the plugins they require, and add their npm packages to its package.json.
 * Refuses a plugin the app already has. Returns the exit code.
 */
export async function add(options: AddOptions, io: Io): Promise<number> {
  const appDir = resolve(io.cwd, options.directory ?? '.')
  if (!existsSync(join(appDir, 'package.json')) || !existsSync(join(appDir, 'src'))) {
    io.stderr.write(
      `error: ${appDir} is not an app (no package.json and src/); run "aimbrace init" first\n`,
    )
    return 1
  }
  const already = options.names.filter((name) => present(appDir, name))
  if (already.length > 0) {
    io.stderr.write(
      `error: the app already has ${already.map((name) => `src/plugins/${name}`).join(', ')}\n`,
    )
    return 1
  }
  const toCopy: LibraryPlugin[] = closure(options.names, readLibrary()).filter(
    (plugin) => !present(appDir, plugin.name),
  )
  const addedDependencies: string[] = []
  for (const plugin of toCopy) {
    copyPlugin(plugin, appDir)
    addedDependencies.push(...mergeDependencies(appDir, plugin.dependencies))
  }
  io.stdout.write(`added ${toCopy.map((plugin) => plugin.name).join(', ')} to ${appDir}\n`)
  if (addedDependencies.length > 0)
    io.stdout.write(`new dependencies: ${addedDependencies.join(', ')} (run npm install)\n`)
  for (const plugin of toCopy.filter((plugin) => options.names.includes(plugin.name))) {
    io.stdout.write(
      `\n${plugin.name}: ${plugin.mount ?? `import it from './plugins/${plugin.name}/index.ts' and mount it in src/app.ts`}\n`,
    )
  }
  return 0
}

/** `aimbrace plugins`: the library, one line per plugin. */
export function listPlugins(io: Io): number {
  for (const plugin of readLibrary().values()) {
    const requires = plugin.requires.length > 0 ? ` (requires ${plugin.requires.join(', ')})` : ''
    io.stdout.write(`${plugin.name.padEnd(12)} ${plugin.description}${requires}\n`)
  }
  return 0
}
