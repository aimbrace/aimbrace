/** Types for the virtual modules served by `@aimbrace/unplugin`. Add `"types": ["@aimbrace/unplugin/virtual"]` or reference this file. */
declare module 'virtual:aimbrace/graph' {
  interface GraphNode {
    id: string
    version?: string
    description?: string
    requires: string[]
    optional: string[]
    provides: string[]
    peers?: Record<string, string>
    index: number
  }
  interface GraphEdge {
    from: string
    to: string
    service: string
    optional: boolean
  }
  interface Diagnostic {
    severity: 'error' | 'warning' | 'info'
    code: string
    message: string
    plugin?: string
    service?: string
  }
  const graph: {
    ok: boolean
    nodes: GraphNode[]
    edges: GraphEdge[]
    order: string[]
    diagnostics: Diagnostic[]
  }
  export default graph
}

declare module 'virtual:aimbrace/mermaid' {
  const mermaid: string
  export default mermaid
}

declare module 'virtual:aimbrace/plugins' {
  const plugins: Array<{
    id: string
    version?: string
    description?: string
    requires: string[]
    optional: string[]
    provides: string[]
    index: number
  }>
  export default plugins
  export const order: string[]
}
