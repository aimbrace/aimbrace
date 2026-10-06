import type { Scope } from '@aimbrace/core'

/** Methods the dispatcher routes. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

/** What a handler receives. Everything is Web-standard apart from `scope`. */
export interface RouteContext {
  /** Unique id of this request, also part of the scope name. */
  readonly id: string
  readonly request: Request
  readonly url: URL
  /** Values of `:name` segments and the `*` wildcard, percent-decoded. */
  readonly params: Readonly<Record<string, string>>
  /**
   * A scope that lives exactly as long as this request: the response body
   * included. Provide request-local services or own resources here.
   */
  readonly scope: Scope
  /** Aborts when the client goes away or the app begins stopping. */
  readonly signal: AbortSignal
  readonly route: Route
}

/** A route handler. Return a Web `Response`. */
export type Handler = (ctx: RouteContext) => Response | Promise<Response>

/** A route: method(s), path pattern and handler. */
export interface Route {
  /** One method, several, or `*` for all. */
  readonly method: HttpMethod | readonly HttpMethod[] | '*'
  /** `/users/:id`, `/files/*`, `/health`. Static segments beat params, params beat wildcards. */
  readonly path: string
  readonly handler: Handler
  /** For listings and logs. */
  readonly name?: string | undefined
}

/** Wraps handlers. Call `next()` at most once. */
export type Middleware = (
  ctx: RouteContext,
  next: () => Promise<Response>,
) => Response | Promise<Response>

/** A middleware registration. */
export interface MiddlewareEntry {
  readonly handler: Middleware
  /** Lower runs first. Default 0. Ties keep registration order. */
  readonly order?: number | undefined
  readonly name?: string | undefined
}

/** Throw from a handler to produce a specific status. The message is sent to the client. */
export class HttpError extends Error {
  readonly status: number
  readonly headers: HeadersInit | undefined

  constructor(
    status: number,
    message?: string,
    options: { headers?: HeadersInit; cause?: unknown } = {},
  ) {
    super(
      message ?? defaultMessage(status),
      options.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'HttpError'
    this.status = status
    this.headers = options.headers
  }
}

function defaultMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Bad Request'
    case 401:
      return 'Unauthorized'
    case 403:
      return 'Forbidden'
    case 404:
      return 'Not Found'
    case 409:
      return 'Conflict'
    case 422:
      return 'Unprocessable Entity'
    case 429:
      return 'Too Many Requests'
    default:
      return `HTTP ${status}`
  }
}
