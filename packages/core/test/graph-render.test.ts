import { describe, expect, it } from 'vitest'
import { buildGraph, type PluginMeta } from '../src'

const metas: PluginMeta[] = [
  {
    id: 'agent',
    version: '1.0.0',
    requires: ['model', 'memory'],
    optional: ['tracing'],
    provides: ['agent'],
  },
  { id: 'memory', requires: [], optional: [], provides: ['memory'] },
  { id: 'openai/model', version: '2.1.0', requires: [], optional: [], provides: ['model'] },
]

describe('Graph renderers', () => {
  const graph = buildGraph(metas)

  it('toText lists plugins in installation order', () => {
    expect(graph.toText()).toBe(
      [
        'Plugin graph: 3 plugins, order memory -> openai/model -> agent',
        '1. memory',
        '     provides memory',
        '2. openai/model v2.1.0',
        '     provides model',
        '3. agent v1.0.0',
        '     requires model (from openai/model)',
        '     requires memory (from memory)',
        '     optional tracing (not provided)',
        '     provides agent',
        '',
        'Diagnostics:',
        '  info I_OPTIONAL_MISSING: Plugin "agent" can use "tracing", which no plugin provides.',
      ].join('\n'),
    )
  })

  it('toMermaid draws provider -> dependent with sanitised ids', () => {
    expect(graph.toMermaid()).toBe(
      [
        'flowchart TD',
        '  p_agent["agent v1.0.0"]',
        '  p_memory["memory"]',
        '  p_openai_model["openai/model v2.1.0"]',
        '  p_openai_model -->|model| p_agent',
        '  p_memory -->|memory| p_agent',
      ].join('\n'),
    )
  })

  it('toMermaid draws optional edges dashed', () => {
    const withOptional = buildGraph([
      { id: 'a', requires: [], optional: ['t'], provides: [] },
      { id: 'b', requires: [], optional: [], provides: ['t'] },
    ])
    expect(withOptional.toMermaid()).toContain('p_b -.->|t| p_a')
  })

  it('toDot escapes labels and marks optional edges', () => {
    const quoted = buildGraph([
      { id: 'a', version: '1.0.0', requires: [], optional: ['t'], provides: [] },
      { id: 'b"x', requires: [], optional: [], provides: ['t'] },
    ])
    expect(quoted.toDot()).toBe(
      [
        'digraph aimbrace {',
        '  rankdir=LR;',
        '  node [shape=box, style=rounded];',
        '  "a" [label="a\\nv1.0.0"];',
        '  "b\\"x" [label="b\\"x"];',
        '  "b\\"x" -> "a" [label="t", style=dashed];',
        '}',
      ].join('\n'),
    )
  })

  it('toJSON is serialisable and drops error objects', () => {
    const broken = buildGraph([{ id: 'a', requires: ['nope'], optional: [], provides: [] }])
    const json = JSON.parse(JSON.stringify(broken))
    expect(json.ok).toBe(false)
    expect(json.order).toEqual([])
    expect(json.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'E_MISSING_DEPENDENCY',
      plugin: 'a',
      service: 'nope',
    })
    expect(json.diagnostics[0].error).toBeUndefined()
    expect(json.nodes[0].index).toBe(0)
  })

  it('toText of an invalid graph lists plugins in registration order and the errors', () => {
    const broken = buildGraph([
      { id: 'a', requires: ['nope'], optional: [], provides: [] },
      { id: 'b', requires: [], optional: [], provides: [] },
    ])
    const text = broken.toText()
    expect(text.startsWith('Plugin graph: 2 plugins\n1. a')).toBe(true)
    expect(text).toContain('error E_MISSING_DEPENDENCY')
  })
})
