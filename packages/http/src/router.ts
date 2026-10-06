import type { HttpMethod, Route } from './types'

type Segment =
  | { kind: 'static'; value: string }
  | { kind: 'param'; value: string }
  | { kind: 'wildcard' }

/** A route with its pattern pre-compiled. */
export interface CompiledRoute {
  readonly route: Route
  readonly methods: ReadonlySet<string> | 'any'
  readonly segments: readonly Segment[]
  /** Per segment: 3 static, 2 param, 1 wildcard. Compared left to right. */
  readonly score: readonly number[]
  readonly order: number
}

/** Result of matching a request against the routes. */
export type MatchResult =
  | { type: 'match'; route: Route; params: Record<string, string> }
  | { type: 'method-not-allowed'; allow: string[] }
  | { type: 'not-found' }

function splitPath(path: string): string[] {
  return path.split('/').filter((part) => part.length > 0)
}

/** Compile a route's path pattern. Throws on an invalid pattern. */
export function compileRoute(route: Route, order: number): CompiledRoute {
  if (!route.path.startsWith('/')) {
    throw new TypeError(`Route path "${route.path}" must start with "/".`)
  }
  const parts = splitPath(route.path)
  const segments: Segment[] = parts.map((part, index) => {
    if (part === '*') {
      if (index !== parts.length - 1) {
        throw new TypeError(`Route path "${route.path}": "*" is only allowed as the last segment.`)
      }
      return { kind: 'wildcard' }
    }
    if (part.startsWith(':')) {
      if (part.length === 1)
        throw new TypeError(`Route path "${route.path}": empty parameter name.`)
      return { kind: 'param', value: part.slice(1) }
    }
    return { kind: 'static', value: part }
  })
  const methods =
    route.method === '*'
      ? 'any'
      : new Set(Array.isArray(route.method) ? route.method : [route.method as HttpMethod])
  const score = segments.map((segment) =>
    segment.kind === 'static' ? 3 : segment.kind === 'param' ? 2 : 1,
  )
  return { route, methods, segments, score, order }
}

function decode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

function matchPath(
  compiled: CompiledRoute,
  parts: readonly string[],
): Record<string, string> | undefined {
  const params: Record<string, string> = {}
  const { segments } = compiled
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index] as Segment
    if (segment.kind === 'wildcard') {
      const rest = parts.slice(index).map((part) => decode(part))
      if (rest.some((part) => part === undefined)) return undefined
      params['*'] = rest.join('/')
      return params
    }
    const part = parts[index]
    if (part === undefined) return undefined
    if (segment.kind === 'static') {
      if (decode(part) !== segment.value) return undefined
    } else {
      const value = decode(part)
      if (value === undefined) return undefined
      params[segment.value] = value
    }
  }
  return parts.length === segments.length ? params : undefined
}

function better(a: CompiledRoute, b: CompiledRoute): boolean {
  const length = Math.max(a.score.length, b.score.length)
  for (let index = 0; index < length; index++) {
    const left = a.score[index] ?? 0
    const right = b.score[index] ?? 0
    if (left !== right) return left > right
  }
  return a.order < b.order
}

/**
 * Match `method` and `pathname` against compiled routes. HEAD falls back to
 * GET. A path that matches only with another method is `method-not-allowed`.
 */
export function matchRoutes(
  routes: readonly CompiledRoute[],
  method: string,
  pathname: string,
): MatchResult {
  const parts = splitPath(pathname)
  const wanted = method.toUpperCase()
  let best: { compiled: CompiledRoute; params: Record<string, string> } | undefined
  let fallback: { compiled: CompiledRoute; params: Record<string, string> } | undefined
  const allow = new Set<string>()
  for (const compiled of routes) {
    const params = matchPath(compiled, parts)
    if (!params) continue
    if (compiled.methods === 'any') {
      for (const name of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
        allow.add(name)
    } else {
      for (const name of compiled.methods) allow.add(name)
    }
    const accepts = compiled.methods === 'any' || compiled.methods.has(wanted)
    if (accepts) {
      if (!best || better(compiled, best.compiled)) best = { compiled, params }
    } else if (wanted === 'HEAD' && compiled.methods.has('GET')) {
      if (!fallback || better(compiled, fallback.compiled)) fallback = { compiled, params }
    }
  }
  const chosen = best ?? fallback
  if (chosen) return { type: 'match', route: chosen.compiled.route, params: chosen.params }
  if (allow.size > 0) {
    if (allow.has('GET')) allow.add('HEAD')
    return { type: 'method-not-allowed', allow: [...allow].sort() }
  }
  return { type: 'not-found' }
}
