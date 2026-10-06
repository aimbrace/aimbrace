/**
 * The app's own routes. Any plugin that injects `http.app` can add routes the same way: it is just a Hono app.
 */
export const routes = {
  name: 'routes',
  inject: ['http.app', 'agent'],
  apply(ctx) {
    const app = ctx.get('http.app')
    const agent = ctx.get('agent')
    app.get('/', (c) => c.json({ app: '__APP_NAME__', ok: true }))
    app.get('/health', (c) => c.json({ ok: true }))
    app.post('/ask', async (c) => {
      const body = await c.req.json().catch(() => undefined)
      if (typeof body?.question !== 'string') return c.json({ error: 'question must be a string' }, 400)
      return c.json(await agent.run(body.question))
    })
    ctx.provide('routes.ready', true)
  },
}
