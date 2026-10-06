import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  DisposerStack,
  DuplicateRegistryEntryError,
  InvalidNameError,
  type ItemOf,
  isRegistryToken,
  type RegistryEvent,
  RegistryStore,
  registry,
} from '../src'

interface Tool {
  name: string
}
const Tools = registry<Tool>('tools', { key: (tool) => tool.name })
const Plain = registry<number>('numbers')

describe('registry()', () => {
  it('creates a frozen token', () => {
    expect(Tools.kind).toBe('registry')
    expect(Tools.name).toBe('tools')
    expect(Object.isFrozen(Tools)).toBe(true)
    expect(isRegistryToken(Tools)).toBe(true)
    expect(isRegistryToken({ kind: 'service' })).toBe(false)
  })

  it('validates names', () => {
    expect(() => registry('no spaces')).toThrow(InvalidNameError)
  })

  it('carries the item type', () => {
    expectTypeOf<ItemOf<typeof Tools>>().toEqualTypeOf<Tool>()
  })
})

describe('RegistryStore', () => {
  it('collects entries from many contributors in insertion order', () => {
    const store = new RegistryStore()
    const a = store.view(Tools)
    const b = store.view(Tools)
    a.add({ name: 'read' })
    b.add({ name: 'write' })
    a.add({ name: 'exec' })
    expect(a.all().map((t) => t.name)).toEqual(['read', 'write', 'exec'])
    expect(b.size).toBe(3)
    expect([...b].map((t) => t.name)).toEqual(['read', 'write', 'exec'])
  })

  it('looks entries up by key and rejects duplicates', () => {
    const view = new RegistryStore().view(Tools)
    const read = { name: 'read' }
    view.add(read)
    expect(view.get('read')).toBe(read)
    expect(view.has('read')).toBe(true)
    expect(view.has('nope')).toBe(false)
    expect(() => view.add({ name: 'read' })).toThrow(DuplicateRegistryEntryError)
    expect(view.size).toBe(1)
  })

  it('does not expose the backing array', () => {
    const view = new RegistryStore().view(Plain)
    view.add(1)
    const snapshot = view.all()
    view.add(2)
    expect(snapshot).toEqual([1])
    expect(() => (snapshot as number[]).push(9)).toThrow()
    expect(view.all()).toEqual([1, 2])
  })

  it('removes only the entries of a disposed owner and tells subscribers', async () => {
    const store = new RegistryStore()
    const events: string[] = []
    store.view(Tools).subscribe((event) => void events.push(`${event.type}:${event.id}`))
    const ownerA = new DisposerStack()
    const ownerB = new DisposerStack()
    store.view(Tools, ownerA).add({ name: 'a1' })
    store.view(Tools, ownerA).add({ name: 'a2' })
    store.view(Tools, ownerB).add({ name: 'b1' })
    expect(store.total()).toBe(3)
    await ownerA.dispose()
    expect(
      store
        .view(Tools)
        .all()
        .map((t) => t.name),
    ).toEqual(['b1'])
    expect(events).toEqual(['add:a1', 'add:a2', 'add:b1', 'remove:a2', 'remove:a1'])
    await ownerB.dispose()
    expect(store.total()).toBe(0)
    expect(store.sizes()).toEqual({})
  })

  it('removes a single entry with the returned function, once', () => {
    const store = new RegistryStore()
    const owner = new DisposerStack()
    const view = store.view(Plain, owner)
    const remove = view.add(7)
    view.add(8)
    remove()
    remove()
    expect(view.all()).toEqual([8])
    expect(owner.size).toBe(1)
  })

  it('releases subscriptions with the owner', async () => {
    const store = new RegistryStore()
    const owner = new DisposerStack()
    let calls = 0
    store.view(Plain, owner).subscribe(() => void calls++)
    expect(store.subscribers()).toBe(1)
    store.view(Plain).add(1)
    expect(calls).toBe(1)
    await owner.dispose()
    expect(store.subscribers()).toBe(0)
    store.view(Plain).add(2)
    expect(calls).toBe(1)
  })

  it('feeds onChange and survives a throwing subscriber', () => {
    const changes: RegistryEvent[] = []
    const reported: unknown[] = []
    const store = new RegistryStore({
      onChange: (event) => void changes.push(event),
      onListenerError: (error) => void reported.push(error),
    })
    const view = store.view(Plain)
    let second = 0
    view.subscribe(() => {
      throw new Error('listener failed')
    })
    view.subscribe(() => void second++)
    view.add(1)
    expect(changes).toEqual([{ type: 'add', registry: 'numbers', item: 1, id: undefined }])
    expect(reported).toHaveLength(1)
    expect(second).toBe(1)
    expect(view.all()).toEqual([1])
  })

  it('treats tokens with the same name as one collection', () => {
    const store = new RegistryStore()
    store.view(registry<number>('shared')).add(1)
    expect(store.view(registry<number>('shared')).all()).toEqual([1])
  })

  it('refuses owned additions after the owner is disposed', async () => {
    const store = new RegistryStore()
    const owner = new DisposerStack()
    await owner.dispose()
    expect(() => store.view(Plain, owner).add(1)).toThrow()
    expect(store.total()).toBe(0)
    expect(store.view(Plain).all()).toEqual([])
  })
})
