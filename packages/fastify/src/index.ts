import { Readable } from 'node:stream'
import { definePlugin, service } from '@aimbrace/core'
import {
  type AddressHolder,
  createAddressHolder,
  HostConfig,
  HttpAddress,
  HttpDispatcher,
} from '@aimbrace/http'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'

/** The native Fastify instance, for host-specific plugins. Using it makes a plugin Fastify-only. */
export const FastifyApp = service<FastifyInstance>('fastify.app', {
  description: 'The Fastify instance serving the HTTP contract',
})

/** Largest request body accepted, in bytes. */
const BODY_LIMIT = 10 * 1024 * 1024

/** Build a Web `Request` from a Fastify request whose body was parsed as a raw buffer. */
export function toWebRequest(req: FastifyRequest, signal: AbortSignal): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const entry of value) headers.append(name, entry)
    else headers.set(name, value)
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const body = hasBody && Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined
  return new Request(`${req.protocol}://${req.host}${req.url}`, {
    method: req.method,
    headers,
    signal,
    // A Buffer is a valid body at runtime; the DOM typings only accept ArrayBuffer-backed views.
    ...(body === undefined ? {} : { body: body as unknown as BodyInit }),
  })
}

/** Write a Web `Response` through a Fastify reply, streaming the body and keeping repeated `Set-Cookie`. */
export function sendWebResponse(reply: FastifyReply, response: Response): FastifyReply {
  reply.status(response.status)
  for (const [name, value] of response.headers) {
    if (name !== 'set-cookie') reply.header(name, value)
  }
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) reply.header('set-cookie', cookies)
  if (response.body === null) return reply.send()
  return reply.send(Readable.fromWeb(response.body as never))
}

interface HostState {
  readonly app: FastifyInstance
  readonly address: AddressHolder
  listening: boolean
}

// One state per activation: the same plugin object can be installed in many apps.
const states = new WeakMap<object, HostState>()

/**
 * Serves the neutral HTTP contract with Fastify. One catch-all hands every
 * request to `HttpDispatcher`, so routes may come and go while it runs.
 *
 * @example
 * createApp({ plugins: [http, fastifyHost({ port: 8080 }), myRoutes] })
 */
export const fastifyHost = definePlugin({
  id: 'fastify-host',
  version: '0.1.0',
  description: 'Fastify HTTP host',
  requires: [HttpDispatcher],
  provides: [FastifyApp, HttpAddress],
  config: HostConfig,
  setup(ctx, config) {
    const dispatcher = ctx.get(HttpDispatcher)
    const app = Fastify({
      logger: false,
      bodyLimit: BODY_LIMIT,
      forceCloseConnections: 'idle',
    })
    // The neutral contract wants the untouched body: parse every content type as a buffer.
    app.removeAllContentTypeParsers()
    app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))
    app.all('/*', async (req, reply) => {
      const controller = new AbortController()
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) controller.abort()
      })
      const response = await dispatcher.dispatch(toWebRequest(req, controller.signal))
      return sendWebResponse(reply, response)
    })
    const state: HostState = { app, address: createAddressHolder(), listening: false }
    states.set(ctx, state)
    ctx.provide(FastifyApp, app)
    ctx.provide(HttpAddress, state.address.view)
    // Even when never started, a fastify instance holds no socket until listen(); close() releases its internals.
    ctx.own(async () => {
      state.listening = false
      await app.close()
    })
    void config
  },
  async start(ctx, config) {
    const state = states.get(ctx)
    if (!state || !config.listen) return
    await state.app.listen({ port: config.port, host: config.hostname })
    const address = state.app.server.address()
    if (address && typeof address === 'object') state.address.set(address.address, address.port)
    state.listening = true
  },
  async stop(ctx, config) {
    const state = states.get(ctx)
    if (!state?.listening) return
    state.listening = false
    state.address.clear()
    // `close()` stops accepting, waits for in-flight requests, and drops idle keep-alive connections.
    const timer = setTimeout(() => state.app.server.closeAllConnections?.(), config.shutdownGraceMs)
    timer.unref?.()
    try {
      await state.app.close()
    } finally {
      clearTimeout(timer)
    }
  },
})
