import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  type App,
  type AppOptions,
  createApp,
  isPlugin,
  isPluginInstance,
  type PluginLike,
} from '@aimbrace/core'
import { type AimbraceConfig, type ConfigEntry, isPluginEntry, validateManifest } from './config'
import { LoaderError } from './errors'
import { resolvePlugin } from './resolve'

/** File names searched by {@link findConfig}, in priority order. */
export const CONFIG_NAMES = [
  'aimbrace.config.ts',
  'aimbrace.config.mjs',
  'aimbrace.config.js',
  'aimbrace.config.cjs',
  'aimbrace.json',
] as const

/** A config with every plugin resolved. */
export interface LoadedConfig {
  /** The file it came from, when loaded from one. */
  file: string | undefined
  /** Directory relative paths were resolved from. */
  baseDir: string
  name: string | undefined
  plugins: PluginLike[]
  onError: AppOptions['onError'] | undefined
}

/** Search `cwd` and its parents for a config file. Returns the first match. */
export async function findConfig(cwd: string = process.cwd()): Promise<string | undefined> {
  let dir = resolve(cwd)
  const { root } = parse(dir)
  while (true) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
    if (dir === root) return undefined
    dir = dirname(dir)
  }
}

/** Resolve every entry of a config into plugins. */
export async function normaliseConfig(
  config: AimbraceConfig,
  baseDir: string,
  file?: string,
): Promise<LoadedConfig> {
  const plugins: PluginLike[] = []
  for (const entry of config.plugins as readonly ConfigEntry[]) {
    if (isPlugin(entry) || isPluginInstance(entry)) plugins.push(entry)
    else if (typeof entry === 'string' || isPluginEntry(entry)) {
      plugins.push(await resolvePlugin(entry, baseDir, file ?? '(inline config)'))
    } else {
      throw new LoaderError(
        'A plugins entry must be a plugin, a specifier string, or { use, config }.',
        {
          file,
        },
      )
    }
  }
  return { file, baseDir, name: config.name, plugins, onError: config.onError }
}

/** Load an `aimbrace.json` manifest or an `aimbrace.config.*` module. */
export async function loadConfig(file: string): Promise<LoadedConfig> {
  const path = resolve(file)
  if (!existsSync(path)) {
    throw new LoaderError(`Config file not found: ${path}`, { file: path })
  }
  const baseDir = dirname(path)
  if (path.endsWith('.json')) {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(path, 'utf8'))
    } catch (cause) {
      throw new LoaderError(`Cannot parse ${path}: ${(cause as Error).message}`, {
        file: path,
        cause,
      })
    }
    const manifest = validateManifest(raw, path)
    return normaliseConfig(
      { name: manifest.name as string, plugins: manifest.plugins },
      baseDir,
      path,
    )
  }
  let mod: Record<string, unknown>
  try {
    mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>
  } catch (cause) {
    const hint = path.endsWith('.ts')
      ? ' TypeScript config files need Node 24 (native type stripping) or a runtime that runs TypeScript.'
      : ''
    throw new LoaderError(`Failed to import ${path}: ${(cause as Error).message}.${hint}`, {
      file: path,
      cause,
    })
  }
  let exported = mod.default ?? mod.config
  if (typeof exported === 'function') exported = await (exported as () => unknown)()
  if (
    typeof exported !== 'object' ||
    exported === null ||
    !Array.isArray((exported as { plugins?: unknown }).plugins)
  ) {
    throw new LoaderError(
      `${path} must export an object with a "plugins" array as default (use defineConfig).`,
      { file: path },
    )
  }
  return normaliseConfig(exported as AimbraceConfig, baseDir, path)
}

/** Build an app from a loaded config. `overrides` win over the config. */
export function createAppFromConfig(
  config: LoadedConfig,
  overrides: Partial<AppOptions> = {},
): App {
  const options: AppOptions = { plugins: config.plugins }
  const name = overrides.name ?? config.name
  if (name !== undefined) options.name = name
  const onError = overrides.onError ?? config.onError
  if (onError !== undefined) options.onError = onError
  return createApp(options)
}

/**
 * Find (or use) a config, load it and create the app. Does not start it.
 *
 * @param fileOrDirectory a config file, or a directory to search from (default: the current directory)
 */
export async function loadApp(
  fileOrDirectory: string = process.cwd(),
  overrides: Partial<AppOptions> = {},
): Promise<App> {
  const target = resolve(fileOrDirectory)
  const file = /\.(json|[cm]?[jt]s)$/.test(target) ? target : await findConfig(target)
  if (!file) {
    throw new LoaderError(
      `No config found from ${target}. Looked for ${CONFIG_NAMES.join(', ')} in it and its parents.`,
    )
  }
  return createAppFromConfig(await loadConfig(file), overrides)
}
