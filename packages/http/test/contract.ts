import { createApp, type PluginLike, service } from '@aimbrace/core'
import { describe, expect, it } from 'vitest'
import {
  get,
  HttpAddress,
  HttpError,
  http,
  json,
  post,
  type Route,
  type RouteContext,
  redirect,
  routesPlugin,
  text,
} from '../src'

async function eventually(check: () => boolean, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() > deadline) throw new Error('eventually timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const RequestId = service<string>('contract-request-id')

/**
 * The contract every host adapter must satisfy. The same plugins run under
 * each host; only the `makeHost` plugin differs. Requests go over a real socket.
 */
export function runHttpContract(label: string, makeHost: () => PluginLike): void {
  async function boot(routes: Route[] = [], extra: PluginLike[] = [], middleware = [] as never[]) {
    const app = createApp({
      plugins: [
        http,
        makeHost(),
        routesPlugin('contract-routes', routes, { middleware }),
        ...extra,
      ],
    })
    await app.start()
    const base = app.get(HttpAddress).url as string
    return { app, base, url: (path: string) => `${base}${path}` }
  }

  describe(`HTTP contract: ${label}`, () => {
    it('listens on a real address and serves a static route', async () => {
      const { app, base, url } = await boot([
        get('/hello', () => text('hello', { headers: { 'x-answer': '42' } })),
      ])
      expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      const response = await fetch(url('/hello'))
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(response.headers.get('x-answer')).toBe('42')
      expect(await response.text()).toBe('hello')
      await app.stop()
      expect(app.probe().clean).toBe(true)
    })

    it('passes params, the query string and request headers', async () => {
      const { app, url } = await boot([
        get('/users/:id/files/*', (ctx) =>
          json({
            id: ctx.params.id,
            rest: ctx.params['*'],
            q: ctx.url.searchParams.getAll('q'),
            agent: ctx.request.headers.get('x-agent'),
          }),
        ),
      ])
      const response = await fetch(url('/users/a%20b/files/x/y.txt?q=1&q=2'), {
        headers: { 'x-agent': 'tester' },
      })
      expect(await response.json()).toEqual({
        id: 'a b',
        rest: 'x/y.txt',
        q: ['1', '2'],
        agent: 'tester',
      })
      await app.stop()
    })

    it('round-trips JSON, large and binary bodies unchanged', async () => {
      const { app, url } = await boot([
        post('/json', async (ctx) => json({ got: await ctx.request.json() })),
        post('/bytes', async (ctx) => {
          const bytes = new Uint8Array(await ctx.request.arrayBuffer())
          return new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })
        }),
      ])
      const payload = { nested: { list: [1, 2, 3], text: 'héllo ☃' } }
      const echoed = await fetch(url('/json'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      expect(await echoed.json()).toEqual({ got: payload })

      const binary = new Uint8Array(200_000).map((_, index) => index % 251)
      const back = await fetch(url('/bytes'), { method: 'POST', body: binary })
      const received = new Uint8Array(await back.arrayBuffer())
      expect(received.length).toBe(binary.length)
      expect(received.every((value, index) => value === binary[index])).toBe(true)
      await app.stop()
    })

    it('answers 404 and 405 (with Allow) in the same shape', async () => {
      const { app, url } = await boot([get('/only', () => text('x'))])
      const missing = await fetch(url('/missing'))
      expect(missing.status).toBe(404)
      expect(await missing.json()).toEqual({ error: 'Not Found' })
      const wrong = await fetch(url('/only'), { method: 'POST', body: 'x' })
      expect(wrong.status).toBe(405)
      expect(wrong.headers.get('allow')).toBe('GET, HEAD')
      expect(await wrong.json()).toEqual({ error: 'Method Not Allowed' })
      await app.stop()
    })

    it('maps HttpError to its status and never leaks other error messages', async () => {
      const { app, url } = await boot([
        get('/teapot', () => {
          throw new HttpError(418, 'I am a teapot', { headers: { 'x-extra': '1' } })
        }),
        get('/boom', () => {
          throw new Error('secret connection string')
        }),
      ])
      const teapot = await fetch(url('/teapot'))
      expect(teapot.status).toBe(418)
      expect(teapot.headers.get('x-extra')).toBe('1')
      expect(await teapot.json()).toEqual({ error: 'I am a teapot' })
      const boom = await fetch(url('/boom'))
      expect(boom.status).toBe(500)
      const body = await boom.text()
      expect(body).toBe('{"error":"Internal Server Error"}')
      expect(body).not.toContain('secret')
      await app.stop()
    })

    it('runs middleware in order and lets one short-circuit', async () => {
      const log: string[] = []
      const wrap = (name: string, order?: number) => ({
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
        order: -5,
        handler: (ctx: RouteContext, next: () => Promise<Response>) =>
          ctx.request.headers.get('authorization')
            ? next()
            : json({ error: 'no token' }, { status: 401 }),
      }
      const { app, url } = await boot([get('/secure', () => text('secret'))], [], [
        wrap('b'),
        gate,
        wrap('a', -1),
      ] as never[])
      const denied = await fetch(url('/secure'))
      expect(denied.status).toBe(401)
      expect(log).toEqual([])
      const allowed = await fetch(url('/secure'), { headers: { authorization: 'Bearer x' } })
      expect(await allowed.text()).toBe('secret')
      expect(log).toEqual(['a:in', 'b:in', 'b:out', 'a:out'])
      await app.stop()
    })

    it('gives every request its own scope and disposes it after the response', async () => {
      const seen: string[] = []
      const { app, url } = await boot([
        get('/scoped', async (ctx) => {
          ctx.scope.provide(RequestId, ctx.id)
          await sleep(15)
          seen.push(ctx.scope.get(RequestId))
          return text(ctx.scope.name)
        }),
      ])
      const names = await Promise.all(
        Array.from({ length: 5 }, async () => (await fetch(url('/scoped'))).text()),
      )
      expect(new Set(names).size).toBe(5)
      expect(new Set(seen).size).toBe(5)
      await eventually(() => app.probe().scopes === 0)
      await app.stop()
      expect(app.probe().clean).toBe(true)
    })

    it('adds and removes routes while the host runs', async () => {
      const { app, url } = await boot()
      expect((await fetch(url('/late'))).status).toBe(404)
      const handle = await app.install(routesPlugin('late', [get('/late', () => text('here'))]))
      expect(await (await fetch(url('/late'))).text()).toBe('here')
      await handle.dispose()
      expect((await fetch(url('/late'))).status).toBe(404)
      await app.stop()
      expect(app.probe().clean).toBe(true)
    })

    it('answers HEAD without a body and keeps the headers', async () => {
      const { app, url } = await boot([
        get('/h', () => text('payload', { headers: { 'x-a': '1' } })),
      ])
      const head = await fetch(url('/h'), { method: 'HEAD' })
      expect(head.status).toBe(200)
      expect(head.headers.get('x-a')).toBe('1')
      expect(await head.text()).toBe('')
      await app.stop()
    })

    it('keeps repeated Set-Cookie headers separate', async () => {
      const { app, url } = await boot([
        get('/cookies', () => {
          const headers = new Headers()
          headers.append('set-cookie', 'a=1; Path=/')
          headers.append('set-cookie', 'b=2; Path=/; HttpOnly')
          return new Response('ok', { headers })
        }),
      ])
      const response = await fetch(url('/cookies'))
      expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/; HttpOnly'])
      await app.stop()
    })

    it('forwards redirects untouched', async () => {
      const { app, url } = await boot([get('/old', () => redirect('/new', 301))])
      const response = await fetch(url('/old'), { redirect: 'manual' })
      expect(response.status).toBe(301)
      expect(response.headers.get('location')).toBe('/new')
      await app.stop()
    })

    it('streams a body incrementally and releases the scope when it ends', async () => {
      const { app, url } = await boot([
        get('/stream', () => {
          const encoder = new TextEncoder()
          return new Response(
            new ReadableStream<Uint8Array>({
              async start(controller) {
                for (const chunk of ['one', 'two', 'three']) {
                  controller.enqueue(encoder.encode(`${chunk}\n`))
                  await sleep(40)
                }
                controller.close()
              },
            }),
          )
        }),
      ])
      const response = await fetch(url('/stream'))
      const reader = (response.body as ReadableStream<Uint8Array>).getReader()
      const decoder = new TextDecoder()
      const started = performance.now()
      const first = decoder.decode((await reader.read()).value)
      expect(first).toBe('one\n')
      expect(performance.now() - started).toBeLessThan(100)
      expect(app.probe().scopes).toBe(1)
      let rest = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        rest += decoder.decode(value)
      }
      expect(rest).toBe('two\nthree\n')
      await eventually(() => app.probe().scopes === 0)
      await app.stop()
    })

    it('aborts the request scope when the client disconnects mid-stream', async () => {
      let abortedInHandler = false
      const { app, url } = await boot([
        get('/slow', (ctx) => {
          ctx.signal.addEventListener('abort', () => {
            abortedInHandler = true
          })
          return new Response(
            new ReadableStream<Uint8Array>({
              async start(controller) {
                controller.enqueue(new TextEncoder().encode('first'))
                await new Promise<void>((resolve) =>
                  ctx.signal.addEventListener('abort', () => resolve()),
                )
                controller.close()
              },
            }),
          )
        }),
      ])
      const client = new AbortController()
      const response = await fetch(url('/slow'), { signal: client.signal })
      const reader = (response.body as ReadableStream<Uint8Array>).getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
      client.abort()
      await reader.read().catch(() => {})
      await eventually(() => abortedInHandler)
      await eventually(() => app.probe().scopes === 0)
      await app.stop()
      expect(app.probe().clean).toBe(true)
    })

    it('handles many concurrent requests and leaves no scope behind', async () => {
      const { app, url } = await boot([
        get('/n/:n', async (ctx) => text(String(Number(ctx.params.n) * 2))),
      ])
      const results = await Promise.all(
        Array.from({ length: 60 }, async (_, n) => (await fetch(url(`/n/${n}`))).text()),
      )
      expect(results).toEqual(Array.from({ length: 60 }, (_, n) => String(n * 2)))
      await eventually(() => app.probe().scopes === 0)
      await app.stop()
      expect(app.probe().clean).toBe(true)
    })

    it('releases the port and the app when stopped', async () => {
      const { app, url } = await boot([get('/up', () => text('up'))])
      expect(await (await fetch(url('/up'))).text()).toBe('up')
      const address = app.get(HttpAddress)
      expect(address.port).toBeGreaterThan(0)
      await app.stop()
      expect(address.url).toBeUndefined()
      await expect(fetch(url('/up'))).rejects.toThrow()
      expect(app.probe().clean).toBe(true)
    })
  })
}
