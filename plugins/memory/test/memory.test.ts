import { createApp } from '@aimbrace/core'
import { withApp } from '@aimbrace/testing'
import { describe, expect, it } from 'vitest'
import memoryPlugin, {
  createMemoryStore,
  createTaskMemory,
  Memory,
  memory,
  TaskMemory,
} from '../src'

describe('createMemoryStore', () => {
  it('remembers and recalls newest first without a query', () => {
    let time = 0
    const store = createMemoryStore({ now: () => ++time })
    store.remember('notes', 'first')
    store.remember('notes', 'second')
    store.remember('other', 'elsewhere')
    expect(store.recall('notes').map((entry) => entry.text)).toEqual(['second', 'first'])
    expect(store.recall('notes', undefined, 1)).toHaveLength(1)
    expect(store.size()).toBe(3)
    expect(store.recall('notes')[0]).toMatchObject({ namespace: 'notes', at: 2, tags: [] })
  })

  it('ranks by matching words, counting tags, ignoring case and punctuation', () => {
    const store = createMemoryStore()
    store.remember('n', 'Buy milk and eggs.')
    store.remember('n', 'Call the plumber', ['urgent'])
    store.remember('n', 'Milk the cow, buy hay')
    expect(store.recall('n', 'BUY milk').map((e) => e.text)).toEqual([
      'Milk the cow, buy hay',
      'Buy milk and eggs.',
    ])
    expect(store.recall('n', 'urgent').map((e) => e.text)).toEqual(['Call the plumber'])
    expect(store.recall('n', 'nothing matches')).toEqual([])
    expect(store.recall('n', 'milk milk milk').length).toBe(2)
  })

  it('evicts the oldest entries beyond maxEntries and clears a namespace', () => {
    const store = createMemoryStore({ maxEntries: 3 })
    for (const text of ['a', 'b', 'c', 'd']) store.remember('n', text)
    expect(store.recall('n', undefined, 10).map((e) => e.text)).toEqual(['d', 'c', 'b'])
    store.remember('x', 'keep')
    expect(store.clear('n')).toBe(2)
    expect(store.size()).toBe(1)
  })

  it('calls onWrite', () => {
    const written: string[] = []
    createMemoryStore({ onWrite: (entry) => void written.push(entry.text) }).remember('n', 'hi')
    expect(written).toEqual(['hi'])
  })
})

describe('createTaskMemory', () => {
  it('uses one namespace whatever it is asked for', () => {
    const task = createTaskMemory()
    task.remember('ignored', 'step one')
    task.remember('also ignored', 'step two')
    expect(task.recall('whatever').map((e) => e.text)).toEqual(['step two', 'step one'])
    expect(task.recall('x', 'one')).toHaveLength(1)
    expect(task.clear('any')).toBe(2)
    expect(task.size()).toBe(0)
    expect(TaskMemory.name).toBe('ai.task-memory')
  })
})

describe('memory plugin', () => {
  it('provides Memory with defaults when used bare, and fires memory:write', async () => {
    const written: string[] = []
    const app = createApp({ plugins: [memoryPlugin] })
    app.hooks.hook('memory:write', (entry) => void written.push(entry.text))
    await app.start()
    app.get(Memory).remember('n', 'hello')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(written).toEqual(['hello'])
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('honours maxEntries and validates it', async () => {
    await withApp({ plugins: [memory({ maxEntries: 2 })] }, (app) => {
      for (const text of ['a', 'b', 'c']) app.get(Memory).remember('n', text)
      expect(app.get(Memory).size()).toBe(2)
    })
    await expect(createApp({ plugins: [memory({ maxEntries: 0 })] }).start()).rejects.toThrow(
      /Invalid config for plugin "memory"/,
    )
  })

  it('keeps separate apps separate', async () => {
    const one = createApp({ plugins: [memory] })
    const two = createApp({ plugins: [memory] })
    await Promise.all([one.start(), two.start()])
    one.get(Memory).remember('n', 'only in one')
    expect(two.get(Memory).size()).toBe(0)
    await Promise.all([one.stop(), two.stop()])
  })
})
