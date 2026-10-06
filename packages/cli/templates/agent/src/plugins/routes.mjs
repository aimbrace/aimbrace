/**
 * The app's own routes, including `POST /ask` for the agent. `ctx.effect` removes each route when this plugin is
 * disposed.
 */
export const routes = {
  name: 'routes',
  inject: ['http', 'agent'],
  apply(ctx) {
    const http = ctx.get('http')
    const agent = ctx.get('agent')
    ctx.effect(() => http.route('GET', '/', () => ({ body: { app: '__APP_NAME__', ok: true } })))
    ctx.effect(() => http.route('GET', '/health', () => ({ body: { ok: true } })))
    ctx.effect(() =>
      http.route('POST', '/ask', async ({ body }) => {
        if (typeof body?.question !== 'string')
          return { status: 400, body: { error: 'question must be a string' } }
        return { body: await agent.run(body.question) }
      }),
    )
  },
}
