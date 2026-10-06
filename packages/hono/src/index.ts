import { definePlugin, service } from '@aimbrace/core'
import {
  type AddressHolder,
  createAddressHolder,
  HostConfig,
  HttpAddress,
  HttpDispatcher,
} from '@aimbrace/http'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'

/** The native Hono instance, for host-specific plugins. Using it makes a plugin Hono-only. */
export const HonoApp = service<Hono>('hono.app', {
  description: 'The Hono application serving the HTTP contract',
})

/** The slice of a Node server the host uses. `serve()` returns a union that includes HTTP/2. */
interface NodeServer {
  close(callback: (error?: Error) => void): unknown
  closeIdleConnections?(): void
  closeAllConnections?(): void
  once(event: 'error', listener: (error: Error) => void): unknown
}

interface HostState {
  readonly hono: Hono
  readonly address: AddressHolder
  server?: NodeServer | undefined
}

// One state per activation: the same plugin object can be installed in many apps.
const states = new WeakMap<object, HostState>()

function closeServer(server: NodeServer, graceMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => server.closeAllConnections?.(), graceMs)
    timer.unref?.()
    server.close((error) => {
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    })
    server.closeIdleConnections?.()
  })
}

/**
 * Serves the neutral HTTP contract with Hono. One catch-all hands every
 * request to `HttpDispatcher`, so routes may come and go while it runs.
 *
 * @example
 * createApp({ plugins: [http, honoHost({ port: 8080 }), myRoutes] })
 */
export const honoHost = definePlugin({
  id: 'hono-host',
  version: '0.1.0',
  description: 'Hono HTTP host',
  requires: [HttpDispatcher],
  provides: [HonoApp, HttpAddress],
  config: HostConfig,
  setup(ctx) {
    const dispatcher = ctx.get(HttpDispatcher)
    const app = new Hono()
    app.all('*', (c) => dispatcher.dispatch(c.req.raw))
    const state: HostState = { hono: app, address: createAddressHolder() }
    states.set(ctx, state)
    ctx.provide(HonoApp, app)
    ctx.provide(HttpAddress, state.address.view)
  },
  async start(ctx, config) {
    const state = states.get(ctx)
    if (!state || !config.listen) return
    state.server = await new Promise<NodeServer>((resolve, reject) => {
      const server = serve(
        { fetch: state.hono.fetch, port: config.port, hostname: config.hostname },
        (info) => {
          state.address.set(info.address, info.port)
          resolve(server as unknown as NodeServer)
        },
      ) as unknown as NodeServer
      server.once('error', reject)
    })
    ctx.own(async () => {
      const server = state.server
      if (!server) return
      state.server = undefined
      await closeServer(server, config.shutdownGraceMs)
    })
  },
  async stop(ctx, config) {
    const state = states.get(ctx)
    const server = state?.server
    if (!state || !server) return
    state.server = undefined
    state.address.clear()
    await closeServer(server, config.shutdownGraceMs)
  },
})
