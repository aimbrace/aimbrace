import { createApp, definePlugin, service } from '@aimbrace/core'
import { describe, expect, it } from 'vitest'
import {
  get,
  HttpDispatcher,
  HttpError,
  http,
  json,
  Middlewares,
  post,
  type RouteContext,
  Routes,
  routesPlugin,
  text,
} from '../src'

const RequestId = service<string>('request-id')

async function boot(
  ...plugins: Parameters<typeof createApp>[0] extends infer O
    ? NonNullable<(O & { plugins?: unknown })['plugins']>
    : never
) {
  const app = createApp({ plugins: [http, ...plugins] })
  await app.start()
  return {
    app,
    dispatch: (path: string, init?: RequestInit) =>
      app.get(HttpDispatcher).dispatch(new Request(`http://test${path}`, init)),
  }
}

describe('dispatcher', () => {
  it('serves registered routes with params, query and a JSON body', async () => {
    const { app, dispatch } = await boot(
      routesPlugin('api', [
        get('/hello/:name', (ctx) =>
          text(`hi ${ctx.params.name} ${ctx.url.searchParams.get('q')}`),
        ),
        post('/echo', async (ctx) => json({ got: await ctx.request.json() })),
      ]),
    )
    expect(await (await dispatch('/hello/ann?q=1')).text()).toBe('hi ann 1')
    const echoed = await dispatch('/echo', { method: 'POST', body: JSON.stringify({ a: 1 }) })
    expect(echoed.headers.get('content-type')).toContain('application/json')
    expect(await echoed.json()).toEqual({ got: { a: 1 } })
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('answers 404 and 405', async () => {
    const { app, dispatch } = await boot(routesPlugin('api', [get('/only', () => text('x'))]))
    const missing = await dispatch('/nope')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'Not Found' })
    const wrong = await dispatch('/only', { method: 'POST', body: 'x' })
    expect(wrong.status).toBe(405)
    expect(wrong.headers.get('allow')).toBe('GET, HEAD')
    await app.stop()
  })

  it('maps HttpError to its status and hides other errors behind a 500', async () => {
    const seen: string[] = []
    const { app, dispatch } = await boot(
      routesPlugin('api', [
        get('/teapot', () => {
          throw new HttpError(418, 'I am a teapot', { headers: { 'x-extra': '1' } })
        }),
        get('/boom', () => {
          throw new Error('secret database password')
        }),
      ]),
    )
    app.hooks.hook('http:error', (_info, error) => void seen.push((error as Error).message))
    const teapot = await dispatch('/teapot')
    expect(teapot.status).toBe(418)
    expect(teapot.headers.get('x-extra')).toBe('1')
    expect(await teapot.json()).toEqual({ error: 'I am a teapot' })
    const boom = await dispatch('/boom')
    expect(boom.status).toBe(500)
    expect(await boom.text()).not.toContain('secret')
    expect(seen).toEqual(['secret database password'])
    await app.stop()
  })

  it('rejects a handler that does not return a Response', async () => {
    const { app, dispatch } = await boot(
      routesPlugin('api', [get('/bad', (() => 'nope') as never)]),
    )
    expect((await dispatch('/bad')).status).toBe(500)
    await app.stop()
  })

  it('runs middleware by order then registration, and lets one short-circuit', async () => {
    const log: string[] = []
    const mw = (name: string, order?: number) => ({
      name,
      order,
      handler: async (_ctx: RouteContext, next: () => Promise<Response>) => {
        log.push(`${name}:in`)
        const response = await next()
        log.push(`${name}:out`)
        return response
      },
    })
    const gate = {
      name: 'gate',
      order: -10,
      handler: (ctx: RouteContext, next: () => Promise<Response>) =>
        ctx.url.searchParams.has('deny') ? text('denied', { status: 401 }) : next(),
    }
    const { app, dispatch } = await boot(
      routesPlugin('api', [get('/m', () => text('ok'))], {
        middleware: [mw('b'), mw('a', -1), gate, mw('c')],
      }),
    )
    expect(await (await dispatch('/m')).text()).toBe('ok')
    expect(log).toEqual(['a:in', 'b:in', 'c:in', 'c:out', 'b:out', 'a:out'])
    log.length = 0
    const denied = await dispatch('/m?deny=1')
    expect(denied.status).toBe(401)
    expect(log).toEqual([])
    await app.stop()
  })

  it('rejects middleware that calls next twice', async () => {
    const twice = {
      handler: async (_ctx: RouteContext, next: () => Promise<Response>) => {
        await next()
        return next()
      },
    }
    const { app, dispatch } = await boot(
      routesPlugin('api', [get('/t', () => text('x'))], { middleware: [twice] }),
    )
    expect((await dispatch('/t')).status).toBe(500)
    await app.stop()
  })

  it('opens a scope per request and disposes it after the response is read', async () => {
    const scopes: string[] = []
    const { app, dispatch } = await boot(
      routesPlugin('api', [
        get('/scoped', (ctx) => {
          ctx.scope.provide(RequestId, ctx.id)
          scopes.push(ctx.scope.name)
          expect(ctx.signal).toBe(ctx.scope.signal)
          return text(ctx.scope.get(RequestId))
        }),
      ]),
    )
    const [a, b] = await Promise.all([dispatch('/scoped'), dispatch('/scoped')])
    expect(app.probe().scopes).toBe(2)
    const ids = [await a.text(), await b.text()]
    expect(new Set(ids).size).toBe(2)
    expect(scopes.map((name) => name.replace('request:', ''))).toEqual(expect.arrayContaining(ids))
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(app.probe().scopes).toBe(0)
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('disposes the scope of a streaming response only when the stream ends, or is cancelled', async () => {
    let release: (() => void) | undefined
    const { app, dispatch } = await boot(
      routesPlugin('api', [
        get('/stream', () => {
          const body = new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode('a'))
              await new Promise<void>((resolve) => {
                release = resolve
              })
              controller.enqueue(new TextEncoder().encode('b'))
              controller.close()
            },
          })
          return new Response(body)
        }),
      ]),
    )
    const response = await dispatch('/stream')
    expect(app.probe().scopes).toBe(1)
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('a')
    expect(app.probe().scopes).toBe(1)
    release?.()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('b')
    expect((await reader.read()).done).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(app.probe().scopes).toBe(0)

    const cancelled = await dispatch('/stream')
    expect(app.probe().scopes).toBe(1)
    await cancelled.body?.cancel()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(app.probe().scopes).toBe(0)
    release?.()
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('strips the body of HEAD responses and keeps headers', async () => {
    const { app, dispatch } = await boot(
      routesPlugin('api', [get('/h', () => text('payload', { headers: { 'x-a': '1' } }))]),
    )
    const head = await dispatch('/h', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('x-a')).toBe('1')
    expect(await head.text()).toBe('')
    await app.stop()
  })

  it('adds and removes routes live as plugins come and go', async () => {
    const { app, dispatch } = await boot()
    expect((await dispatch('/late')).status).toBe(404)
    const handle = await app.install(routesPlugin('late', [get('/late', () => text('here'))]))
    expect(await (await dispatch('/late')).text()).toBe('here')
    expect(
      app
        .get(HttpDispatcher)
        .routes()
        .map((route) => route.path),
    ).toEqual(['/late'])
    await handle.dispose()
    expect((await dispatch('/late')).status).toBe(404)
    await app.stop()
    expect(app.probe().clean).toBe(true)
  })

  it('fires request and response hooks with timing', async () => {
    const events: string[] = []
    const { app, dispatch } = await boot(routesPlugin('api', [get('/ok', () => text('x'))]))
    app.hooks.hook('http:request', (info) => void events.push(`req ${info.method} ${info.path}`))
    app.hooks.hook(
      'http:response',
      (info) => void events.push(`res ${info.status} ${info.durationMs >= 0}`),
    )
    await dispatch('/ok')
    expect(events).toEqual(['req GET /ok', 'res 200 true'])
    await app.stop()
  })

  it('lets plugins read app services through the request scope', async () => {
    const Config = service<{ name: string }>('app-config')
    const config = definePlugin({
      id: 'config',
      provides: [Config],
      setup: (ctx) => void ctx.provide(Config, { name: 'demo' }),
    })
    const { app, dispatch } = await boot(
      config,
      routesPlugin('api', [get('/name', (ctx) => text(ctx.scope.get(Config).name))]),
    )
    expect(await (await dispatch('/name')).text()).toBe('demo')
    await app.stop()
  })

  it('answers 499 for an already aborted request', async () => {
    const { app, dispatch } = await boot(routesPlugin('api', [get('/a', () => text('x'))]))
    const controller = new AbortController()
    controller.abort()
    expect((await dispatch('/a', { signal: controller.signal })).status).toBe(499)
    await app.stop()
  })

  it('exposes route registry tokens for plugins that want to add routes directly', async () => {
    const direct = definePlugin({
      id: 'direct',
      setup(ctx) {
        ctx.registry(Routes).add({ method: 'GET', path: '/direct', handler: () => text('direct') })
        ctx.registry(Middlewares).add({ handler: (_c, next) => next() })
      },
    })
    const { app, dispatch } = await boot(direct)
    expect(await (await dispatch('/direct')).text()).toBe('direct')
    await app.stop()
  })
})
