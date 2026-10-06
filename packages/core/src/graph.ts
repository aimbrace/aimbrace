import {
  type AimbraceError,
  DependencyCycleError,
  DuplicatePluginError,
  DuplicateProviderError,
  GraphValidationError,
  MissingDependencyError,
  PeerError,
} from './errors'
import { isValidRange, parseVersion, satisfies } from './semver'

/**
 * Plain, JSON-friendly description of one plugin: what the graph needs.
 * `Plugin.meta` has this shape, and so can a manifest read from disk.
 */
export interface PluginMeta {
  readonly id: string
  readonly version?: string | undefined
  readonly description?: string | undefined
  /** Names of services that must be provided. */
  readonly requires: readonly string[]
  /** Names of services used when present. */
  readonly optional: readonly string[]
  /** Names of services this plugin provides. */
  readonly provides: readonly string[]
  /** Peer plugin id -> version range. */
  readonly peers?: Readonly<Record<string, string>> | undefined
}

/** A plugin in the graph. */
export interface GraphNode extends PluginMeta {
  /** Position in the registration list. Breaks ordering ties. */
  readonly index: number
}

/** The provider must be installed before the dependent. */
export interface GraphEdge {
  /** The provider. */
  readonly from: string
  /** The dependent. */
  readonly to: string
  readonly service: string
  readonly optional: boolean
}

/** One finding of the graph build. */
export interface GraphDiagnostic {
  readonly severity: 'error' | 'warning' | 'info'
  readonly code: string
  readonly message: string
  readonly plugin?: string
  readonly service?: string
  /** The typed error for `error` diagnostics. */
  readonly error?: AimbraceError
}

/** Options for {@link buildGraph}. */
export interface BuildGraphOptions {
  /** Services that are already available (for example in a running app). */
  external?: Iterable<string>
}

/**
 * A validated dependency graph. Pure data plus renderers: it can be built from
 * a running app, from plugin objects, or from a JSON manifest.
 */
export class Graph {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  /** Plugin ids in installation order. Empty when the graph has errors. */
  readonly order: readonly string[]
  readonly diagnostics: readonly GraphDiagnostic[]

  constructor(
    nodes: readonly GraphNode[],
    edges: readonly GraphEdge[],
    order: readonly string[],
    diagnostics: readonly GraphDiagnostic[],
  ) {
    this.nodes = nodes
    this.edges = edges
    this.order = order
    this.diagnostics = diagnostics
  }

  /** True when there are no error diagnostics. */
  get ok(): boolean {
    return !this.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  }

  /** The typed errors, in diagnostic order. */
  get errors(): AimbraceError[] {
    return this.diagnostics.flatMap((diagnostic) =>
      diagnostic.severity === 'error' && diagnostic.error ? [diagnostic.error] : [],
    )
  }

  /** Throw the single error, or a {@link GraphValidationError} when there are several. */
  assertValid(): void {
    const errors = this.errors
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new GraphValidationError(errors)
  }

  node(id: string): GraphNode | undefined {
    return this.nodes.find((node) => node.id === id)
  }

  /** Plugins that `id` depends on directly. */
  dependenciesOf(id: string): string[] {
    return unique(this.edges.filter((edge) => edge.to === id).map((edge) => edge.from))
  }

  /** Plugins that depend on `id` directly. */
  dependentsOf(id: string): string[] {
    return unique(this.edges.filter((edge) => edge.from === id).map((edge) => edge.to))
  }

  /** A readable listing in installation order. */
  toText(): string {
    const lines: string[] = []
    const ids = this.ok ? this.order : this.nodes.map((node) => node.id)
    lines.push(
      `Plugin graph: ${this.nodes.length} plugin${this.nodes.length === 1 ? '' : 's'}${
        this.ok && ids.length > 0 ? `, order ${ids.join(' -> ')}` : ''
      }`,
    )
    ids.forEach((id, position) => {
      const node = this.node(id)
      if (!node) return
      lines.push(`${position + 1}. ${label(node)}`)
      const needs = this.edges.filter((edge) => edge.to === id)
      for (const service of node.requires) {
        const from = needs.find((edge) => edge.service === service && !edge.optional)?.from
        lines.push(`     requires ${service}${from ? ` (from ${from})` : ''}`)
      }
      for (const service of node.optional) {
        const from = needs.find((edge) => edge.service === service && edge.optional)?.from
        lines.push(`     optional ${service}${from ? ` (from ${from})` : ' (not provided)'}`)
      }
      for (const service of node.provides) lines.push(`     provides ${service}`)
    })
    if (this.diagnostics.length > 0) {
      lines.push('')
      lines.push('Diagnostics:')
      for (const diagnostic of this.diagnostics) {
        lines.push(`  ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`)
      }
    }
    return lines.join('\n')
  }

  /** A Mermaid `flowchart` where arrows point from provider to dependent. */
  toMermaid(): string {
    const lines = ['flowchart TD']
    for (const node of this.nodes) {
      lines.push(`  ${mermaidId(node.id)}["${escapeMermaid(label(node))}"]`)
    }
    for (const edge of this.edges) {
      const arrow = edge.optional ? '-.->' : '-->'
      lines.push(
        `  ${mermaidId(edge.from)} ${arrow}|${escapeMermaid(edge.service)}| ${mermaidId(edge.to)}`,
      )
    }
    return lines.join('\n')
  }

  /** A Graphviz DOT digraph where arrows point from provider to dependent. */
  toDot(): string {
    const lines = ['digraph aimbrace {', '  rankdir=LR;', '  node [shape=box, style=rounded];']
    for (const node of this.nodes) {
      lines.push(`  ${dotString(node.id)} [label=${dotString(label(node, '\n'))}];`)
    }
    for (const edge of this.edges) {
      lines.push(
        `  ${dotString(edge.from)} -> ${dotString(edge.to)} [label=${dotString(edge.service)}${
          edge.optional ? ', style=dashed' : ''
        }];`,
      )
    }
    lines.push('}')
    return lines.join('\n')
  }

  /** A serialisable snapshot. */
  toJSON(): {
    ok: boolean
    nodes: readonly GraphNode[]
    edges: readonly GraphEdge[]
    order: readonly string[]
    diagnostics: Array<Omit<GraphDiagnostic, 'error'>>
  } {
    return {
      ok: this.ok,
      nodes: this.nodes,
      edges: this.edges,
      order: this.order,
      diagnostics: this.diagnostics.map(({ error: _error, ...rest }) => rest),
    }
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function label(node: PluginMeta, separator = ' '): string {
  return node.version ? `${node.id}${separator}v${node.version}` : node.id
}

function mermaidId(id: string): string {
  return `p_${id.replace(/[^A-Za-z0-9_]/g, '_')}`
}

function escapeMermaid(text: string): string {
  return text.replace(/"/g, '&quot;').replace(/\|/g, '&#124;')
}

function dotString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

function distance(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  let previous = Array.from({ length: y.length + 1 }, (_, index) => index)
  for (let i = 1; i <= x.length; i++) {
    const current = [i]
    for (let j = 1; j <= y.length; j++) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (x[i - 1] === y[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[y.length] ?? 0
}

function suggest(wanted: string, known: Iterable<string>): string[] {
  const threshold = Math.max(2, Math.floor(wanted.length * 0.3))
  return [...known]
    .map((name) => ({ name, score: distance(wanted, name) }))
    .filter((entry) => entry.score > 0 && entry.score <= threshold)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((entry) => entry.name)
}

/** Minimal binary min-heap of numbers. */
class MinHeap {
  #items: number[] = []

  get size(): number {
    return this.#items.length
  }

  push(value: number): void {
    const items = this.#items
    items.push(value)
    let child = items.length - 1
    while (child > 0) {
      const parent = (child - 1) >> 1
      if ((items[parent] as number) <= (items[child] as number)) break
      ;[items[parent], items[child]] = [items[child] as number, items[parent] as number]
      child = parent
    }
  }

  pop(): number | undefined {
    const items = this.#items
    const top = items[0]
    const last = items.pop()
    if (items.length > 0 && last !== undefined) {
      items[0] = last
      let parent = 0
      while (true) {
        const left = parent * 2 + 1
        const right = left + 1
        let smallest = parent
        if (left < items.length && (items[left] as number) < (items[smallest] as number))
          smallest = left
        if (right < items.length && (items[right] as number) < (items[smallest] as number))
          smallest = right
        if (smallest === parent) break
        ;[items[parent], items[smallest]] = [items[smallest] as number, items[parent] as number]
        parent = smallest
      }
    }
    return top
  }
}

/** Strongly connected components of `adjacency` (iterative Tarjan). */
function stronglyConnected(count: number, adjacency: number[][]): number[][] {
  const index = new Array<number>(count).fill(-1)
  const low = new Array<number>(count).fill(0)
  const onStack = new Array<boolean>(count).fill(false)
  const stack: number[] = []
  const components: number[][] = []
  let counter = 0

  for (let root = 0; root < count; root++) {
    if (index[root] !== -1) continue
    const work: Array<{ node: number; next: number }> = [{ node: root, next: 0 }]
    index[root] = low[root] = counter++
    stack.push(root)
    onStack[root] = true
    while (work.length > 0) {
      const frame = work[work.length - 1] as { node: number; next: number }
      const neighbours = adjacency[frame.node] as number[]
      if (frame.next < neighbours.length) {
        const target = neighbours[frame.next++] as number
        if (index[target] === -1) {
          index[target] = low[target] = counter++
          stack.push(target)
          onStack[target] = true
          work.push({ node: target, next: 0 })
        } else if (onStack[target]) {
          low[frame.node] = Math.min(low[frame.node] as number, index[target] as number)
        }
      } else {
        if (low[frame.node] === index[frame.node]) {
          const component: number[] = []
          let member: number
          do {
            member = stack.pop() as number
            onStack[member] = false
            component.push(member)
          } while (member !== frame.node)
          components.push(component)
        }
        work.pop()
        const parent = work[work.length - 1]
        if (parent)
          low[parent.node] = Math.min(low[parent.node] as number, low[frame.node] as number)
      }
    }
  }
  return components
}

/** One concrete cycle inside a strongly connected component, as node indexes (first repeated at the end). */
function findCycle(component: number[], adjacency: number[][]): number[] {
  const members = new Set(component)
  const start = Math.min(...component)
  const path: number[] = [start]
  const visited = new Set<number>([start])
  const walk = (node: number): boolean => {
    for (const next of adjacency[node] as number[]) {
      if (!members.has(next)) continue
      if (next === start) {
        path.push(start)
        return true
      }
      if (visited.has(next)) continue
      visited.add(next)
      path.push(next)
      if (walk(next)) return true
      path.pop()
    }
    return false
  }
  walk(start)
  return path
}

/**
 * Build and validate the dependency graph of a set of plugins.
 *
 * Pure: no plugin code runs. Pass the metas in registration order; ties in the
 * installation order are broken by that order.
 */
export function buildGraph(metas: readonly PluginMeta[], options: BuildGraphOptions = {}): Graph {
  const diagnostics: GraphDiagnostic[] = []
  const external = new Set(options.external ?? [])
  const addError = (error: AimbraceError, extra: { plugin?: string; service?: string } = {}) => {
    diagnostics.push({
      severity: 'error',
      code: error.code,
      message: error.message,
      error,
      ...extra,
    })
  }

  // 1. nodes, duplicates by id
  const nodes: GraphNode[] = []
  const byId = new Map<string, GraphNode>()
  metas.forEach((meta, position) => {
    if (byId.has(meta.id)) {
      addError(new DuplicatePluginError(meta.id), { plugin: meta.id })
      return
    }
    const node: GraphNode = { ...meta, index: position }
    byId.set(meta.id, node)
    nodes.push(node)
  })
  const indexOf = new Map(nodes.map((node, position) => [node.id, position]))

  // 2. providers
  const providers = new Map<string, string[]>()
  for (const node of nodes) {
    for (const service of node.provides) {
      const list = providers.get(service) ?? []
      list.push(node.id)
      providers.set(service, list)
    }
  }
  for (const [service, list] of providers) {
    if (list.length > 1) addError(new DuplicateProviderError(service, list), { service })
  }
  const knownServices = [...providers.keys(), ...external]

  // 3. required edges
  const edges: GraphEdge[] = []
  const requireAdjacency: number[][] = nodes.map(() => []) // dependent -> provider
  for (const node of nodes) {
    for (const service of node.requires) {
      const provider = providers.get(service)?.[0]
      if (provider === undefined) {
        if (external.has(service)) continue
        addError(new MissingDependencyError(node.id, service, suggest(service, knownServices)), {
          plugin: node.id,
          service,
        })
        continue
      }
      edges.push({ from: provider, to: node.id, service, optional: false })
      const from = indexOf.get(node.id) as number
      const to = indexOf.get(provider) as number
      if (!requireAdjacency[from]?.includes(to)) requireAdjacency[from]?.push(to)
    }
  }

  // 4. cycles among required edges
  const components = stronglyConnected(nodes.length, requireAdjacency)
  const cyclic = components
    .filter((component) => {
      const only = component[0] as number
      return component.length > 1 || (requireAdjacency[only] as number[]).includes(only)
    })
    .sort((a, b) => Math.min(...a) - Math.min(...b))
  for (const component of cyclic) {
    const path = findCycle(component, requireAdjacency).map(
      (position) => (nodes[position] as GraphNode).id,
    )
    addError(new DependencyCycleError(path), { plugin: path[0] as string })
  }

  // 5. optional edges, dropped when they would close a cycle
  const reachable = (from: number, target: number): boolean => {
    const seen = new Set<number>([from])
    const stack = [from]
    while (stack.length > 0) {
      const current = stack.pop() as number
      if (current === target) return true
      for (const next of requireAdjacency[current] as number[]) {
        if (!seen.has(next)) {
          seen.add(next)
          stack.push(next)
        }
      }
    }
    return false
  }
  if (cyclic.length === 0) {
    for (const node of nodes) {
      for (const service of node.optional) {
        const provider = providers.get(service)?.[0]
        if (provider === undefined) {
          if (!external.has(service)) {
            diagnostics.push({
              severity: 'info',
              code: 'I_OPTIONAL_MISSING',
              message: `Plugin "${node.id}" can use "${service}", which no plugin provides.`,
              plugin: node.id,
              service,
            })
          }
          continue
        }
        const from = indexOf.get(node.id) as number
        const to = indexOf.get(provider) as number
        if (from === to || reachable(to, from)) {
          diagnostics.push({
            severity: 'warning',
            code: 'W_OPTIONAL_CYCLE_DROPPED',
            message: `Optional dependency of "${node.id}" on "${service}" (from "${provider}") would close a cycle and was ignored.`,
            plugin: node.id,
            service,
          })
          continue
        }
        edges.push({ from: provider, to: node.id, service, optional: true })
        if (!requireAdjacency[from]?.includes(to)) requireAdjacency[from]?.push(to)
      }
    }
  }

  // 6. peers
  for (const node of nodes) {
    for (const [peer, range] of Object.entries(node.peers ?? {})) {
      const found = byId.get(peer)
      if (!isValidRange(range)) {
        addError(new PeerError(node.id, peer, range, found?.version, true), { plugin: node.id })
      } else if (!found) {
        addError(new PeerError(node.id, peer, range, undefined), { plugin: node.id })
      } else if (
        !(found.version && parseVersion(found.version) && satisfies(found.version, range))
      ) {
        addError(new PeerError(node.id, peer, range, found.version ?? '(no version)'), {
          plugin: node.id,
        })
      }
    }
  }

  // 7. order: Kahn with ties broken by registration index
  let order: string[] = []
  if (!diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    const dependents: number[][] = nodes.map(() => [])
    const pending = new Array<number>(nodes.length).fill(0)
    for (const [dependent, list] of requireAdjacency.entries()) {
      for (const provider of list) {
        ;(dependents[provider] as number[]).push(dependent)
        pending[dependent] = (pending[dependent] as number) + 1
      }
    }
    const ready = new MinHeap()
    pending.forEach((count, position) => {
      if (count === 0) ready.push(position)
    })
    while (ready.size > 0) {
      const position = ready.pop() as number
      order.push((nodes[position] as GraphNode).id)
      for (const dependent of dependents[position] as number[]) {
        pending[dependent] = (pending[dependent] as number) - 1
        if (pending[dependent] === 0) ready.push(dependent)
      }
    }
    if (order.length !== nodes.length) order = []
  }

  return new Graph(nodes, edges, order, diagnostics)
}
