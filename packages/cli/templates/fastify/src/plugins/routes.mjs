/**
 * The app's own routes. Any plugin that injects `http.app` can add routes the same way: it is just a Fastify instance.
 */
export const routes = {
  name: 'routes',
  inject: ['http.app'],
  apply(ctx) {
    const app = ctx.get('http.app')
    app.get('/', async () => ({ app: '__APP_NAME__', ok: true }))
    app.get('/health', async () => ({ ok: true }))
    ctx.provide('routes.ready', true)
  },
}
