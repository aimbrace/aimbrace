import type { AppOptions, PluginLike } from '@aimbrace/core'
import { LoaderError } from './errors'

/** A plugin named by specifier, with optional config. */
export interface PluginEntry {
  /** A path (relative to the config file) or a package name. */
  use: string
  /** Passed to the plugin as its config, or to a factory export as its argument. */
  config?: unknown
}

/** One item of `plugins`: a plugin, a configured instance, a specifier, or a specifier with config. */
export type ConfigEntry = PluginLike | string | PluginEntry

/** What an `aimbrace.config.*` module describes. */
export interface AimbraceConfig {
  name?: string
  plugins: readonly ConfigEntry[]
  onError?: AppOptions['onError']
}

/** The JSON manifest shape: like {@link AimbraceConfig} but only data. */
export interface AimbraceManifest {
  name?: string
  plugins: ReadonlyArray<string | PluginEntry>
}

/**
 * Declare an app's configuration with type checking.
 *
 * @example
 * export default defineConfig({
 *   name: 'demo',
 *   plugins: ['./plugins/hello.js', { use: '@scope/store', config: { path: 'data' } }],
 * })
 */
export function defineConfig(config: AimbraceConfig): AimbraceConfig {
  return config
}

const MANIFEST_KEYS = new Set(['name', 'plugins', '$schema'])
const ENTRY_KEYS = new Set(['use', 'config'])

/** Validate the shape of a parsed `aimbrace.json`. Throws {@link LoaderError} naming the problem. */
export function validateManifest(raw: unknown, file: string): AimbraceManifest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new LoaderError('The manifest must be a JSON object.', { file })
  }
  for (const key of Object.keys(raw)) {
    if (!MANIFEST_KEYS.has(key)) {
      throw new LoaderError(`Unknown manifest key "${key}". Allowed keys: name, plugins.`, { file })
    }
  }
  const manifest = raw as { name?: unknown; plugins?: unknown }
  if (manifest.name !== undefined && typeof manifest.name !== 'string') {
    throw new LoaderError('"name" must be a string.', { file })
  }
  if (!Array.isArray(manifest.plugins)) {
    throw new LoaderError('"plugins" must be an array.', { file })
  }
  manifest.plugins.forEach((entry, index) => {
    if (typeof entry === 'string') return
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new LoaderError(`plugins[${index}] must be a string or an object with "use".`, { file })
    }
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) {
        throw new LoaderError(
          `plugins[${index}] has unknown key "${key}". Allowed keys: use, config.`,
          { file },
        )
      }
    }
    if (typeof (entry as { use?: unknown }).use !== 'string') {
      throw new LoaderError(`plugins[${index}].use must be a string.`, { file })
    }
  })
  return manifest as AimbraceManifest
}

/** True when `value` looks like a {@link PluginEntry}. */
export function isPluginEntry(value: unknown): value is PluginEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { use?: unknown }).use === 'string' &&
    (value as { kind?: unknown }).kind === undefined
  )
}
