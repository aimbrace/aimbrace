import { createUnplugin } from 'unplugin'
import { type AimbraceUnpluginOptions, type LoadedGraph, loadGraph } from './graph'

/** Virtual module ids. Import them from application code. */
export const VIRTUAL_GRAPH = 'virtual:aimbrace/graph'
export const VIRTUAL_MERMAID = 'virtual:aimbrace/mermaid'
export const VIRTUAL_PLUGINS = 'virtual:aimbrace/plugins'

const RESOLVED = '\0'
const VIRTUAL = new Set([VIRTUAL_GRAPH, VIRTUAL_MERMAID, VIRTUAL_PLUGINS])

function render(id: string, { graph }: LoadedGraph): string {
  switch (id) {
    case VIRTUAL_GRAPH:
      return `export default ${JSON.stringify(graph.toJSON())}\n`
    case VIRTUAL_MERMAID:
      return `export default ${JSON.stringify(graph.toMermaid())}\n`
    default:
      return `export default ${JSON.stringify(graph.nodes)}\nexport const order = ${JSON.stringify(graph.order)}\n`
  }
}

/**
 * One definition, every bundler: validates the AIMBRACE plugin graph when the
 * build starts and serves it as virtual modules.
 *
 * - `virtual:aimbrace/graph`: the graph as JSON (`{ ok, nodes, edges, order, diagnostics }`)
 * - `virtual:aimbrace/mermaid`: the graph as a Mermaid flowchart string
 * - `virtual:aimbrace/plugins`: the plugin metadata list (default export) and `order`
 */
export const unplugin = createUnplugin<AimbraceUnpluginOptions | undefined>((options = {}) => {
  let loaded: LoadedGraph | undefined
  /** In non-strict mode the problem is reported once, from the first hook that can warn. */
  let pendingWarning: string | undefined
  /** `addWatchFile` is only allowed in resolveId, load and transform under esbuild, so it is registered from resolveId. */
  let watching = false
  return {
    name: 'aimbrace',
    async buildStart() {
      loaded = await loadGraph(options)
      watching = false
      const { graph } = loaded
      if (!graph.ok) {
        const message = `Invalid AIMBRACE plugin graph:\n${graph.errors.map((error) => `  - ${error.message}`).join('\n')}`
        // `buildStart` cannot call this.error or this.warn in every bundler; a throw fails the build everywhere.
        if (options.strict === false) pendingWarning = message
        else throw new Error(message)
      }
    },
    watchChange(id) {
      if (loaded?.file && id === loaded.file) loaded = undefined
    },
    resolveId(id) {
      if (!watching && loaded?.file) {
        watching = true
        this.addWatchFile(loaded.file)
      }
      if (!VIRTUAL.has(id)) return undefined
      // Some adapters (esbuild) only forward warnings from a resolveId that returns a result.
      if (pendingWarning) {
        this.warn(pendingWarning)
        pendingWarning = undefined
      }
      return `${RESOLVED}${id}`
    },
    buildEnd() {
      // A build that never imported a virtual module still gets told its graph is invalid.
      if (pendingWarning) {
        console.warn(`[aimbrace] ${pendingWarning}`)
        pendingWarning = undefined
      }
    },
    async load(id) {
      if (!id.startsWith(RESOLVED) || !VIRTUAL.has(id.slice(1))) return undefined
      loaded ??= await loadGraph(options)
      return render(id.slice(1), loaded)
    },
  }
})
