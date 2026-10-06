import { describe, expect, expectTypeOf, it } from 'vitest'
import { InvalidNameError, isServiceToken, type ServiceToken, service, type ValueOf } from '../src'

interface Database {
  query(sql: string): string[]
}

describe('service()', () => {
  it('creates a frozen token with its name', () => {
    const Database = service<Database>('database', { description: 'SQL access' })
    expect(Database.kind).toBe('service')
    expect(Database.name).toBe('database')
    expect(Database.description).toBe('SQL access')
    expect(Object.isFrozen(Database)).toBe(true)
  })

  it('accepts namespaced names', () => {
    expect(service('acme/db:primary.v2').name).toBe('acme/db:primary.v2')
  })

  it.each(['', '1abc', '-x', 'has space', 'bad$char'])('rejects the name %j', (name) => {
    expect(() => service(name)).toThrow(InvalidNameError)
  })

  it('rejects non-string names with a stable error code', () => {
    try {
      service(42 as never)
      expect.unreachable()
    } catch (error) {
      expect((error as InvalidNameError).code).toBe('E_INVALID_NAME')
    }
  })

  it('recognises tokens', () => {
    expect(isServiceToken(service('x'))).toBe(true)
    expect(isServiceToken({ kind: 'registry' })).toBe(false)
    expect(isServiceToken(null)).toBe(false)
  })

  it('carries the value type at compile time', () => {
    const Database = service<Database>('database')
    expectTypeOf(Database).toEqualTypeOf<ServiceToken<Database>>()
    expectTypeOf<ValueOf<typeof Database>>().toEqualTypeOf<Database>()
  })

  it('keeps tokens of different value types distinct', () => {
    const A = service<{ a: 1 }>('a')
    const B = service<{ b: 2 }>('b')
    expectTypeOf<ValueOf<typeof A>>().not.toEqualTypeOf<ValueOf<typeof B>>()
  })
})
