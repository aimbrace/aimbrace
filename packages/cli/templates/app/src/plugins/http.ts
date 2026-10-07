import type { Context } from '@deepseek-ai/cordis'

/** A request as routes see it: the method, the path and the parsed JSON body, if any. */
export interface RouteRequest {
  method: string
  path: string
  body: unknown
}

/** What a route answers. The status defaults to 200; the body is sent as JSON. */
export interface Reply {
  status?: number
  body: unknown
}

export type Handler = (request: RouteRequest) => Reply | Promise<Reply>

/** The router service. Plugins add routes; the server asks it to answer requests. */
export interface Http {
  /** Add a route. Returns the function that removes it, so it can be the disposer of a `ctx.effect`. */
  route(method: string, path: string, handler: Handler): () => void
  /** Answer a request from the registered routes, 404 when none matches. */
  handle(request: RouteRequest): Promise<{ status: number; body: unknown }>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    http: Http
  }
}

/** Provides the `http` router. Nothing listens here: see the `server` plugin. */
export function http(ctx: Context) {
  const routes = new Map<string, Handler>()
  ctx.provide(
    'http',
    {
      route(method, path, handler) {
        const key = `${method} ${path}`
        if (routes.has(key)) throw new Error(`route ${key} is already registered`)
        routes.set(key, handler)
        return () => void routes.delete(key)
      },
      async handle(request) {
        const handler = routes.get(`${request.method} ${request.path}`)
        if (!handler) return { status: 404, body: { error: 'not found' } }
        const reply = await handler(request)
        return { status: reply.status ?? 200, body: reply.body }
      },
    } satisfies Http,
  )
}
