/**
 * Starts listening once the routes are ready. The returned disposer closes the server when this plugin is disposed.
 */
export const server = {
  name: 'server',
  inject: ['http.app', 'routes.ready', 'config'],
  async apply(ctx) {
    const { port, hostname } = ctx.config
    const app = ctx.get('http.app')
    await app.listen({ port, host: hostname })
    const address = app.server.address()
    ctx.provide('http.address', { hostname: address.address, port: address.port, url: `http://${address.address}:${address.port}` })
    return () => app.close()
  },
}
