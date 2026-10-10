import type { Context } from '@deepseek-ai/cordis'

/** A request as routes see it: the method, the path and the parsed JSON body, if any. */
export interface RouteRequest {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

/** What a route answers. The status defaults to 200; the body is sent as JSON. */
/** Sends one server-sent event: `topic` is the event name, `data` is sent as JSON. */
export type Send = (topic: string, data: unknown) => void

/** A live stream: called when a client connects, it returns what to run when the client leaves. */
export type Stream = (send: Send) => () => void

export interface Reply {
  readonly status?: number
  readonly body: unknown
  /** Answer with a stream of server-sent events instead of a JSON body. */
  readonly stream?: Stream
}

export type Handler = (request: RouteRequest) => Reply | Promise<Reply>

/** The router service. Plugins add routes; the server asks it to answer requests. */
export interface Http {
  /** Add a route. Returns the function that removes it, so it can be the disposer of a `ctx.effect`. */
  route(method: string, path: string, handler: Handler): () => void
  /** Answer a request from the registered routes, 404 when none matches. */
  handle(request: RouteRequest): Promise<{ status: number; body: unknown; stream?: Stream }>
  /** The registered routes, as `METHOD /path`. */
  list(): string[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    http: Http
  }
}

/** Provides the `http` router. Nothing listens here: see the `server` plugin. */
export function http(ctx: Context) {
  const routes = new Map<string, Handler>()
  ctx.provide('http', {
    route(method, path, handler) {
      const key = `${method.toUpperCase()} ${path}`
      if (routes.has(key)) throw new Error(`route ${key} is already registered`)
      routes.set(key, handler)
      return () => void routes.delete(key)
    },
    async handle(request) {
      const handler = routes.get(`${request.method.toUpperCase()} ${request.path}`)
      if (!handler) return { status: 404, body: { error: 'not found' } }
      const reply = await handler(request)
      return {
        status: reply.status ?? 200,
        body: reply.body,
        ...(reply.stream ? { stream: reply.stream } : {}),
      }
    },
    list: () => [...routes.keys()].sort(),
  } satisfies Http)
}
