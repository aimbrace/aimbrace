import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** An installed package that declares an AIMBRACE plugin entry. */
export interface DiscoveredPlugin {
  name: string
  version: string | undefined
  description: string | undefined
  /** Absolute path of the module that exports the plugin. */
  entry: string
  packageDir: string
}

interface PackageJson {
  name?: string
  version?: string
  description?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  aimbrace?: { plugin?: string }
}

function readJson(path: string): PackageJson | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageJson
  } catch {
    return undefined
  }
}

function findUp(start: string, file: string): string | undefined {
  let dir = resolve(start)
  while (true) {
    const candidate = join(dir, file)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function packageDirOf(name: string, from: string): string | undefined {
  let dir = resolve(from)
  while (true) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function describe(packageDir: string): DiscoveredPlugin | undefined {
  const manifest = readJson(join(packageDir, 'package.json'))
  const entry = manifest?.aimbrace?.plugin
  if (!manifest?.name || !entry) return undefined
  return {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    entry: resolve(packageDir, entry),
    packageDir,
  }
}

/**
 * List installed packages that declare `"aimbrace": { "plugin": "<entry>" }`.
 * Looks at the dependencies of the nearest `package.json` and at `@aimbrace/plugin-*` packages in `node_modules`.
 */
export function discoverPlugins(cwd: string = process.cwd()): DiscoveredPlugin[] {
  const found = new Map<string, DiscoveredPlugin>()
  const manifestPath = findUp(cwd, 'package.json')
  if (manifestPath) {
    const manifest = readJson(manifestPath)
    const names = [
      ...Object.keys(manifest?.dependencies ?? {}),
      ...Object.keys(manifest?.devDependencies ?? {}),
    ]
    for (const name of names) {
      const dir = packageDirOf(name, dirname(manifestPath))
      const plugin = dir ? describe(dir) : undefined
      if (plugin) found.set(plugin.name, plugin)
    }
    const scopeDir = join(dirname(manifestPath), 'node_modules', '@aimbrace')
    if (existsSync(scopeDir)) {
      for (const entry of readdirSync(scopeDir)) {
        if (!entry.startsWith('plugin-')) continue
        const plugin = describe(join(scopeDir, entry))
        if (plugin) found.set(plugin.name, plugin)
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}
