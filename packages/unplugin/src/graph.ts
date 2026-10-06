import { buildGraph, type Graph, type PluginLike, resolvePluginLike } from '@aimbrace/core'
import { findConfig, loadConfig } from '@aimbrace/loader'

/** Options of the AIMBRACE Unplugin. */
export interface AimbraceUnpluginOptions {
  /** A config module or manifest. Default: found by walking up from `cwd`. */
  config?: string
  /** Plugins given directly instead of a config file. */
  plugins?: readonly PluginLike[]
  /** `true` (default): an invalid graph fails the build. `false`: it only warns. */
  strict?: boolean
  /** Where to look for the config. Default `process.cwd()`. */
  cwd?: string
}

/** What was loaded: the graph and the file it came from. */
export interface LoadedGraph {
  graph: Graph
  /** The config file, when one was used (watched by the bundler). */
  file: string | undefined
}

/** Load the project's plugins and build their dependency graph. */
export async function loadGraph(options: AimbraceUnpluginOptions = {}): Promise<LoadedGraph> {
  if (options.plugins) {
    const metas = options.plugins.map((plugin) => resolvePluginLike(plugin).plugin.meta)
    return { graph: buildGraph(metas), file: undefined }
  }
  const file = options.config ?? (await findConfig(options.cwd ?? process.cwd()))
  if (!file) {
    throw new Error(
      `@aimbrace/unplugin: no aimbrace config found from ${options.cwd ?? process.cwd()}. Pass \`config\` or \`plugins\`.`,
    )
  }
  const loaded = await loadConfig(file)
  const metas = loaded.plugins.map((plugin) => resolvePluginLike(plugin).plugin.meta)
  return { graph: buildGraph(metas), file: loaded.file }
}
