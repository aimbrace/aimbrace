import { registry, service } from '@aimbrace/core'
import type { MatchResult } from './router'
import type { MiddlewareEntry, Route } from './types'

/** The routes every plugin contributes to. Entries are removed when their plugin is disposed. */
export const Routes = registry<Route>('http.routes', {
  description: 'HTTP routes contributed by plugins',
  key: (route) =>
    `${Array.isArray(route.method) ? route.method.join(',') : String(route.method)} ${route.path}`,
})

/** The middleware chain every plugin contributes to. */
export const Middlewares = registry<MiddlewareEntry>('http.middleware', {
  description: 'HTTP middleware contributed by plugins',
})

/** Turns a Web `Request` into a `Response` using the registered routes. Hosts call it. */
export interface HttpDispatcher {
  dispatch(request: Request): Promise<Response>
  /** Match without running anything. */
  match(method: string, pathname: string): MatchResult
  /** The routes currently registered. */
  routes(): readonly Route[]
}
export const HttpDispatcher = service<HttpDispatcher>('http.dispatcher', {
  description: 'Dispatches Web requests to registered routes',
})

/** Where the host is listening. Filled in once the host has started. */
export interface HttpAddress {
  readonly hostname: string | undefined
  readonly port: number | undefined
  /** `http://hostname:port`, or `undefined` until listening. */
  readonly url: string | undefined
}
export const HttpAddress = service<HttpAddress>('http.address', {
  description: 'The address the HTTP host listens on',
})

/** Facts about a request, passed to HTTP hooks. */
export interface HttpRequestInfo {
  readonly id: string
  readonly method: string
  readonly path: string
}

/** Facts about a finished response. */
export interface HttpResponseInfo extends HttpRequestInfo {
  readonly status: number
  readonly durationMs: number
}

declare module '@aimbrace/core' {
  interface HookExtensions {
    /** A request arrived and its scope was opened. */
    'http:request': (info: HttpRequestInfo) => void | Promise<void>
    /** The handler produced a response (the body may still be streaming). */
    'http:response': (info: HttpResponseInfo) => void | Promise<void>
    /** A handler threw something that is not an `HttpError`. */
    'http:error': (info: HttpRequestInfo, error: unknown) => void | Promise<void>
  }
}
