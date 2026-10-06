import type { BaseContext, Registry, Scope } from '@aimbrace/core'
import { json } from './response'
import { type CompiledRoute, compileRoute, type MatchResult, matchRoutes } from './router'
import type { HttpDispatcher, HttpRequestInfo } from './tokens'
import {
  HttpError,
  type Middleware,
  type MiddlewareEntry,
  type Route,
  type RouteContext,
} from './types'

/** What the dispatcher needs from its plugin context. */
export interface DispatcherContext {
  scope: BaseContext['scope']
  hooks: BaseContext['hooks']
}

/** Keep the scope alive until the response body has been read or cancelled, then dispose it once. */
function bindScopeToBody(
  response: Response,
  scope: Scope,
  report: (error: unknown) => void,
): Response {
  const end = () => scope.dispose().catch(report)
  const body = response.body
  if (body === null) {
    void end()
    return response
  }
  const reader = body.getReader()
  let finished = false
  const finish = () => {
    if (finished) return Promise.resolve()
    finished = true
    return end()
  }
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          await finish()
        } else {
          controller.enqueue(value)
        }
      } catch (error) {
        controller.error(error)
        await finish()
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {})
      await finish()
    },
  })
  return new Response(stream, response)
}

function compose(
  entries: readonly MiddlewareEntry[],
  final: (ctx: RouteContext) => Promise<Response>,
) {
  return (ctx: RouteContext): Promise<Response> => {
    const run = (index: number): Promise<Response> => {
      const entry = entries[index]
      if (!entry) return final(ctx)
      let called = false
      const next = () => {
        if (called)
          return Promise.reject(
            new Error(`Middleware "${entry.name ?? index}" called next() twice.`),
          )
        called = true
        return run(index + 1)
      }
      return Promise.resolve().then(() => (entry.handler as Middleware)(ctx, next))
    }
    return run(0)
  }
}

/** Create the dispatcher over live registries of routes and middleware. */
export function createDispatcher(options: {
  ctx: DispatcherContext
  routes: Registry<Route>
  middleware: Registry<MiddlewareEntry>
  report: (error: unknown, where: string) => void
}): HttpDispatcher {
  const { ctx, routes, middleware, report } = options
  let compiled: CompiledRoute[] | undefined
  routes.subscribe(() => {
    compiled = undefined
  })
  const current = (): CompiledRoute[] => {
    compiled ??= routes.all().map((route, index) => compileRoute(route, index))
    return compiled
  }

  const callHook = (fn: () => Promise<void>) =>
    fn().catch((error: unknown) => report(error, 'http hook'))

  return {
    routes: () => routes.all(),
    match: (method, pathname): MatchResult => matchRoutes(current(), method, pathname),

    async dispatch(request) {
      const started = performance.now()
      const url = new URL(request.url)
      const id = crypto.randomUUID()
      const info: HttpRequestInfo = { id, method: request.method, path: url.pathname }
      let scope: Scope
      try {
        scope = await ctx.scope(`request:${id}`, { signal: request.signal })
      } catch (error) {
        if (request.signal.aborted) return new Response(null, { status: 499 })
        report(error, 'http request scope')
        return json({ error: 'Service Unavailable' }, { status: 503 })
      }

      let response: Response
      try {
        await ctx.hooks.callHook('http:request', info)
        const match = matchRoutes(current(), request.method, url.pathname)
        if (match.type === 'not-found') {
          response = json({ error: 'Not Found' }, { status: 404 })
        } else if (match.type === 'method-not-allowed') {
          response = json(
            { error: 'Method Not Allowed' },
            { status: 405, headers: { allow: match.allow.join(', ') } },
          )
        } else {
          const routeContext: RouteContext = {
            id,
            request,
            url,
            params: Object.freeze(match.params),
            scope,
            signal: scope.signal,
            route: match.route,
          }
          const chain = [...middleware.all()]
            .map((entry, index) => ({ entry, index }))
            .sort((a, b) => (a.entry.order ?? 0) - (b.entry.order ?? 0) || a.index - b.index)
            .map(({ entry }) => entry)
          response = await compose(chain, async (c) => {
            const result = await c.route.handler(c)
            if (!(result instanceof Response)) {
              throw new TypeError(
                `Handler of ${c.route.method} ${c.route.path} must return a Response.`,
              )
            }
            return result
          })(routeContext)
        }
      } catch (error) {
        if (error instanceof HttpError) {
          const headers = new Headers(error.headers)
          headers.set('content-type', 'application/json; charset=utf-8')
          response = new Response(JSON.stringify({ error: error.message }), {
            status: error.status,
            headers,
          })
        } else {
          await callHook(async () => ctx.hooks.callHook('http:error', info, error))
          response = json({ error: 'Internal Server Error' }, { status: 500 })
        }
      }

      await callHook(async () =>
        ctx.hooks.callHook('http:response', {
          ...info,
          status: response.status,
          durationMs: performance.now() - started,
        }),
      )
      if (request.method === 'HEAD') {
        response = new Response(null, response)
      }
      return bindScopeToBody(response, scope, (error) => report(error, 'http request scope'))
    },
  }
}
