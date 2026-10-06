import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isPlugin, isPluginInstance, type PluginLike } from '@aimbrace/core'
import type { PluginEntry } from './config'
import { LoaderError } from './errors'

function isPathSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || isAbsolute(specifier)
}

/** Find the entry file of an installed package, honouring ESM-only `exports`. */
function resolveBare(specifier: string, baseDir: string): string {
  const require = createRequire(join(baseDir, 'noop.js'))
  try {
    return require.resolve(specifier)
  } catch (cause) {
    // ESM-only packages have no "require" or "default" condition: read the manifest ourselves.
    const [scope, name] = specifier.startsWith('@') ? specifier.split('/') : [undefined, specifier]
    const packageName = scope ? `${scope}/${name}` : (name as string)
    let dir = baseDir
    while (true) {
      const manifestPath = join(dir, 'node_modules', packageName, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          exports?: unknown
          module?: string
          main?: string
        }
        const root = dirname(manifestPath)
        const exp = manifest.exports
        const entry =
          typeof exp === 'string'
            ? exp
            : typeof exp === 'object' && exp !== null
              ? pickCondition((exp as Record<string, unknown>)['.'] ?? exp)
              : (manifest.module ?? manifest.main)
        if (entry) return resolve(root, entry)
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    throw cause
  }
}

function pickCondition(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  for (const condition of ['import', 'default', 'node', 'module']) {
    const found = pickCondition(record[condition])
    if (found) return found
  }
  return undefined
}

/** Turn what a module exports into plugins, calling factories with `config`. */
async function unwrap(
  mod: Record<string, unknown>,
  config: unknown,
  specifier: string,
  file: string,
): Promise<PluginLike> {
  const candidates = [mod.default, mod.plugin].filter((value) => value !== undefined)
  if (candidates.length === 0) {
    const named = Object.values(mod).filter((value) => isPlugin(value) || isPluginInstance(value))
    if (named.length === 1) candidates.push(named[0] as PluginLike)
  }
  for (const candidate of candidates) {
    if (isPluginInstance(candidate)) {
      if (config !== undefined) {
        throw new LoaderError(
          `"${specifier}" exports an already configured plugin, so "config" in the manifest cannot be applied.`,
          { file, specifier },
        )
      }
      return candidate
    }
    if (isPlugin(candidate)) {
      return config === undefined
        ? candidate
        : (candidate as unknown as (config: unknown) => PluginLike)(config)
    }
    if (typeof candidate === 'function') {
      const produced = await (candidate as (config: unknown) => unknown)(config)
      if (isPlugin(produced) || isPluginInstance(produced)) return produced
    }
  }
  throw new LoaderError(
    `"${specifier}" does not export a plugin. Export one as \`default\` or as \`plugin\` (created with definePlugin), or a function that returns one.`,
    { file, specifier },
  )
}

/**
 * Resolve a plugin specifier to a plugin.
 *
 * @param entry a specifier or `{ use, config }`
 * @param baseDir directory that relative specifiers and bare package names resolve from
 * @param file the config file, for error messages
 */
export async function resolvePlugin(
  entry: string | PluginEntry,
  baseDir: string,
  file: string,
): Promise<PluginLike> {
  const specifier = typeof entry === 'string' ? entry : entry.use
  const config = typeof entry === 'string' ? undefined : entry.config
  let target: string
  try {
    target = isPathSpecifier(specifier)
      ? resolve(baseDir, specifier)
      : resolveBare(specifier, baseDir)
  } catch (cause) {
    throw new LoaderError(
      `Cannot find plugin "${specifier}" from ${baseDir}. Is the package installed, or the path correct?`,
      { file, specifier, cause },
    )
  }
  let mod: Record<string, unknown>
  try {
    mod = (await import(pathToFileURL(target).href)) as Record<string, unknown>
  } catch (cause) {
    throw new LoaderError(
      `Failed to import plugin "${specifier}" (${target}): ${(cause as Error).message}`,
      {
        file,
        specifier,
        cause,
      },
    )
  }
  return unwrap(mod, config, specifier, file)
}
