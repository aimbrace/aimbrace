/**
 * The app's own routes. Any plugin that injects `http` adds routes the same way; `ctx.effect` removes them again when
 * the plugin is disposed.
 */
export const routes = {
  name: 'routes',
  inject: ['http'],
  apply(ctx) {
    const http = ctx.get('http')
    ctx.effect(() => http.route('GET', '/', () => ({ body: { app: '__APP_NAME__', ok: true } })))
    ctx.effect(() => http.route('GET', '/health', () => ({ body: { ok: true } })))
  },
}
