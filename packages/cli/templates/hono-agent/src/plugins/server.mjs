import { serve } from '@hono/node-server'

/**
 * Starts listening once the routes are ready. The returned disposer closes the server when this plugin is disposed.
 */
export const server = {
  name: 'server',
  inject: ['http.app', 'routes.ready', 'config'],
  apply(ctx) {
    const { port, hostname } = ctx.config
    return new Promise((resolve) => {
      const listening = serve({ fetch: ctx.get('http.app').fetch, port, hostname }, (address) => resolve({ listening, address }))
    }).then(({ listening, address }) => {
      ctx.provide('http.address', { hostname: address.address, port: address.port, url: `http://${address.address}:${address.port}` })
      return () => new Promise((done) => listening.close(() => done()))
    })
  },
}
