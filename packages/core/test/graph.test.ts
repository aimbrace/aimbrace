import { describe, expect, it } from 'vitest'
import {
  buildGraph,
  DependencyCycleError,
  DuplicatePluginError,
  DuplicateProviderError,
  GraphValidationError,
  MissingDependencyError,
  type PeerError,
  type PluginMeta,
} from '../src'

function meta(id: string, parts: Partial<Omit<PluginMeta, 'id'>> = {}): PluginMeta {
  return { id, requires: [], optional: [], provides: [], ...parts }
}

describe('ordering', () => {
  it('orders by dependencies regardless of the listing order', () => {
    const graph = buildGraph([
      meta('agent', { requires: ['memory'], provides: ['agent'] }),
      meta('memory', { requires: ['config'], provides: ['memory'] }),
      meta('config', { provides: ['config'] }),
    ])
    expect(graph.ok).toBe(true)
    expect(graph.order).toEqual(['config', 'memory', 'agent'])
  })

  it('follows registration order for independent plugins', () => {
    const graph = buildGraph([meta('c'), meta('a'), meta('b')])
    expect(graph.order).toEqual(['c', 'a', 'b'])
  })

  it('places a shared dependency once, before both dependents (diamond)', () => {
    const graph = buildGraph([
      meta('top', { requires: ['left', 'right'] }),
      meta('left', { requires: ['base'], provides: ['left'] }),
      meta('right', { requires: ['base'], provides: ['right'] }),
      meta('base', { provides: ['base'] }),
    ])
    expect(graph.order).toEqual(['base', 'left', 'right', 'top'])
  })

  it('breaks ties by registration index even when dependencies pull a plugin later', () => {
    const graph = buildGraph([
      meta('z-late', { requires: ['x'] }),
      meta('a-early'),
      meta('x-provider', { provides: ['x'] }),
    ])
    expect(graph.order).toEqual(['a-early', 'x-provider', 'z-late'])
  })

  it('treats external services as satisfied', () => {
    const graph = buildGraph([meta('late', { requires: ['logger'] })], { external: ['logger'] })
    expect(graph.ok).toBe(true)
    expect(graph.order).toEqual(['late'])
    expect(graph.edges).toEqual([])
  })

  it('exposes direct dependencies and dependents', () => {
    const graph = buildGraph([
      meta('a', { provides: ['a'] }),
      meta('b', { requires: ['a'] }),
      meta('c', { requires: ['a'] }),
    ])
    expect(graph.dependentsOf('a')).toEqual(['b', 'c'])
    expect(graph.dependenciesOf('b')).toEqual(['a'])
    expect(graph.node('c')?.index).toBe(2)
  })
})

describe('validation', () => {
  it('reports a missing required service with a close-name suggestion', () => {
    const graph = buildGraph([
      meta('agent', { requires: ['modle'] }),
      meta('openai', { provides: ['model'] }),
    ])
    expect(graph.ok).toBe(false)
    expect(graph.order).toEqual([])
    const error = graph.errors[0] as MissingDependencyError
    expect(error).toBeInstanceOf(MissingDependencyError)
    expect(error.plugin).toBe('agent')
    expect(error.service).toBe('modle')
    expect(error.suggestions).toEqual(['model'])
    expect(error.message).toContain('Did you mean "model"?')
    expect(() => graph.assertValid()).toThrow(MissingDependencyError)
  })

  it('reports duplicate plugin ids and ignores the later one', () => {
    const graph = buildGraph([meta('a', { provides: ['x'] }), meta('a', { provides: ['y'] })])
    expect(graph.errors[0]).toBeInstanceOf(DuplicatePluginError)
    expect(graph.nodes).toHaveLength(1)
  })

  it('reports a service with two providers', () => {
    const graph = buildGraph([meta('a', { provides: ['db'] }), meta('b', { provides: ['db'] })])
    const error = graph.errors[0] as DuplicateProviderError
    expect(error).toBeInstanceOf(DuplicateProviderError)
    expect(error.providers).toEqual(['a', 'b'])
  })

  it('reports a three plugin cycle with its path', () => {
    const graph = buildGraph([
      meta('a', { requires: ['b'], provides: ['a'] }),
      meta('b', { requires: ['c'], provides: ['b'] }),
      meta('c', { requires: ['a'], provides: ['c'] }),
    ])
    const error = graph.errors[0] as DependencyCycleError
    expect(error).toBeInstanceOf(DependencyCycleError)
    expect(error.cycle).toEqual(['a', 'b', 'c', 'a'])
    expect(error.message).toBe('Dependency cycle: a -> b -> c -> a.')
    expect(graph.order).toEqual([])
  })

  it('reports a plugin that requires what it provides', () => {
    const graph = buildGraph([meta('loop', { requires: ['x'], provides: ['x'] })])
    expect((graph.errors[0] as DependencyCycleError).cycle).toEqual(['loop', 'loop'])
  })

  it('reports one cycle per separate component', () => {
    const graph = buildGraph([
      meta('a', { requires: ['b'], provides: ['a'] }),
      meta('b', { requires: ['a'], provides: ['b'] }),
      meta('c', { requires: ['d'], provides: ['c'] }),
      meta('d', { requires: ['c'], provides: ['d'] }),
      meta('ok', { provides: ['ok'] }),
    ])
    const cycles = graph.errors.map((error) => (error as DependencyCycleError).cycle)
    expect(cycles).toEqual([
      ['a', 'b', 'a'],
      ['c', 'd', 'c'],
    ])
  })

  it('aggregates several problems', () => {
    const graph = buildGraph([
      meta('a', { requires: ['nope'] }),
      meta('b', { provides: ['x'] }),
      meta('c', { provides: ['x'] }),
    ])
    expect(graph.errors).toHaveLength(2)
    try {
      graph.assertValid()
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(GraphValidationError)
      expect((error as GraphValidationError).errors).toHaveLength(2)
      expect((error as GraphValidationError).message).toContain('2 problems')
    }
  })

  it('does not throw for a valid graph', () => {
    expect(() => buildGraph([meta('a')]).assertValid()).not.toThrow()
  })
})

describe('optional dependencies', () => {
  it('is valid when the optional service is absent, with an info diagnostic', () => {
    const graph = buildGraph([meta('agent', { optional: ['tracing'] })])
    expect(graph.ok).toBe(true)
    expect(graph.diagnostics).toMatchObject([{ severity: 'info', code: 'I_OPTIONAL_MISSING' }])
  })

  it('orders the provider first when it exists', () => {
    const graph = buildGraph([
      meta('agent', { optional: ['tracing'] }),
      meta('otel', { provides: ['tracing'] }),
    ])
    expect(graph.order).toEqual(['otel', 'agent'])
    expect(graph.edges).toEqual([{ from: 'otel', to: 'agent', service: 'tracing', optional: true }])
  })

  it('drops an optional edge that would close a cycle', () => {
    const graph = buildGraph([
      meta('a', { requires: ['b'], provides: ['a'] }),
      meta('b', { optional: ['a'], provides: ['b'] }),
    ])
    expect(graph.ok).toBe(true)
    expect(graph.order).toEqual(['b', 'a'])
    expect(graph.diagnostics).toMatchObject([
      { severity: 'warning', code: 'W_OPTIONAL_CYCLE_DROPPED', plugin: 'b', service: 'a' },
    ])
  })

  it('drops an optional self dependency', () => {
    const graph = buildGraph([meta('a', { optional: ['x'], provides: ['x'] })])
    expect(graph.ok).toBe(true)
    expect(graph.diagnostics[0]?.code).toBe('W_OPTIONAL_CYCLE_DROPPED')
  })
})

describe('peers', () => {
  const logger = (version?: string) => meta('logger', version ? { version } : {})

  it('accepts a registered peer that satisfies the range', () => {
    const graph = buildGraph([meta('app', { peers: { logger: '^1.2.0' } }), logger('1.4.0')])
    expect(graph.ok).toBe(true)
  })

  it('reports a missing peer', () => {
    const graph = buildGraph([meta('app', { peers: { logger: '^1.0.0' } })])
    const error = graph.errors[0] as PeerError
    expect(error.code).toBe('E_MISSING_PEER')
    expect(error.found).toBeUndefined()
  })

  it('reports a version mismatch', () => {
    const graph = buildGraph([meta('app', { peers: { logger: '^2.0.0' } }), logger('1.4.0')])
    const error = graph.errors[0] as PeerError
    expect(error.code).toBe('E_PEER_VERSION')
    expect(error.found).toBe('1.4.0')
    expect(error.message).toContain('version 1.4.0 is registered')
  })

  it('reports an unversioned peer when a range is required', () => {
    const graph = buildGraph([meta('app', { peers: { logger: '^1.0.0' } }), logger()])
    expect((graph.errors[0] as PeerError).found).toBe('(no version)')
  })

  it('reports an invalid range', () => {
    const graph = buildGraph([meta('app', { peers: { logger: 'banana' } }), logger('1.0.0')])
    expect((graph.errors[0] as PeerError).code).toBe('E_INVALID_RANGE')
  })
})

describe('performance (FR-210)', () => {
  it('builds a 1,000 plugin chain in well under 200 ms', () => {
    const metas: PluginMeta[] = []
    for (let i = 0; i < 1000; i++) {
      metas.push(
        meta(`p${i}`, {
          requires: i === 0 ? [] : [`s${i - 1}`],
          optional: i % 10 === 0 && i > 0 ? [`s${i - 1}`] : [],
          provides: [`s${i}`],
        }),
      )
    }
    metas.reverse()
    const started = performance.now()
    const graph = buildGraph(metas)
    const elapsed = performance.now() - started
    expect(graph.ok).toBe(true)
    expect(graph.order).toHaveLength(1000)
    expect(graph.order[0]).toBe('p0')
    expect(graph.order[999]).toBe('p999')
    expect(elapsed).toBeLessThan(200)
  })
})
