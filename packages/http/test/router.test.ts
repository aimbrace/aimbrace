import { describe, expect, it } from 'vitest'
import { compileRoute, matchRoutes, type Route, text } from '../src'

const handler = () => text('x')
const make = (method: Route['method'], path: string): Route => ({ method, path, handler })
const compile = (...routes: Route[]) => routes.map((route, index) => compileRoute(route, index))

describe('compileRoute', () => {
  it('rejects bad patterns', () => {
    expect(() => compileRoute(make('GET', 'no-slash'), 0)).toThrow(/must start with/)
    expect(() => compileRoute(make('GET', '/a/*/b'), 0)).toThrow(/last segment/)
    expect(() => compileRoute(make('GET', '/a/:'), 0)).toThrow(/empty parameter/)
  })
})

describe('matchRoutes', () => {
  it('matches static, param and wildcard paths and decodes values', () => {
    const routes = compile(
      make('GET', '/'),
      make('GET', '/users/:id'),
      make('GET', '/files/*'),
      make('GET', '/a b'),
    )
    expect(matchRoutes(routes, 'GET', '/')).toMatchObject({ type: 'match', params: {} })
    expect(matchRoutes(routes, 'GET', '/users/42')).toMatchObject({ params: { id: '42' } })
    expect(matchRoutes(routes, 'GET', '/users/a%20b')).toMatchObject({ params: { id: 'a b' } })
    expect(matchRoutes(routes, 'GET', '/files/x/y/z.txt')).toMatchObject({
      params: { '*': 'x/y/z.txt' },
    })
    expect(matchRoutes(routes, 'GET', '/files')).toMatchObject({ params: { '*': '' } })
    expect(matchRoutes(routes, 'GET', '/a%20b')).toMatchObject({ type: 'match' })
  })

  it('ignores a trailing slash', () => {
    const routes = compile(make('GET', '/users/'))
    expect(matchRoutes(routes, 'GET', '/users').type).toBe('match')
    expect(matchRoutes(routes, 'GET', '/users/').type).toBe('match')
  })

  it('prefers static over param over wildcard, whatever the registration order', () => {
    const wildcard = make('GET', '/u/*')
    const param = make('GET', '/u/:id')
    const exact = make('GET', '/u/me')
    for (const order of [
      [wildcard, param, exact],
      [exact, param, wildcard],
      [param, wildcard, exact],
    ]) {
      const routes = compile(...order)
      expect((matchRoutes(routes, 'GET', '/u/me') as { route: Route }).route).toBe(exact)
      expect((matchRoutes(routes, 'GET', '/u/you') as { route: Route }).route).toBe(param)
      expect((matchRoutes(routes, 'GET', '/u/a/b') as { route: Route }).route).toBe(wildcard)
    }
  })

  it('breaks exact ties by registration order', () => {
    const first = make('GET', '/same')
    const second = make('*', '/same')
    const routes = compile(first, second)
    expect((matchRoutes(routes, 'GET', '/same') as { route: Route }).route).toBe(first)
    expect((matchRoutes(routes, 'POST', '/same') as { route: Route }).route).toBe(second)
  })

  it('reports 404 and 405 with the allowed methods', () => {
    const routes = compile(make('GET', '/r'), make(['POST', 'PUT'], '/r'))
    expect(matchRoutes(routes, 'GET', '/nothing')).toEqual({ type: 'not-found' })
    expect(matchRoutes(routes, 'DELETE', '/r')).toEqual({
      type: 'method-not-allowed',
      allow: ['GET', 'HEAD', 'POST', 'PUT'],
    })
  })

  it('falls back from HEAD to GET but prefers an explicit HEAD route', () => {
    const get = make('GET', '/h')
    const head = make('HEAD', '/h')
    expect((matchRoutes(compile(get), 'HEAD', '/h') as { route: Route }).route).toBe(get)
    expect((matchRoutes(compile(get, head), 'HEAD', '/h') as { route: Route }).route).toBe(head)
  })

  it('is case-insensitive for the method and case-sensitive for the path', () => {
    const routes = compile(make('GET', '/Case'))
    expect(matchRoutes(routes, 'get', '/Case').type).toBe('match')
    expect(matchRoutes(routes, 'GET', '/case').type).toBe('not-found')
  })

  it('treats a malformed percent escape as no match instead of throwing', () => {
    const routes = compile(make('GET', '/u/:id'))
    expect(matchRoutes(routes, 'GET', '/u/%E0%A4%A').type).toBe('not-found')
  })
})
