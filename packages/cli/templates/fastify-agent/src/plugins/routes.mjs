/**
 * The app's own routes. Any plugin that injects `http.app` can add routes the same way: it is just a Fastify instance.
 */
export const routes = {
  name: 'routes',
  inject: ['http.app', 'agent'],
  apply(ctx) {
    const app = ctx.get('http.app')
    const agent = ctx.get('agent')
    app.get('/', async () => ({ app: '__APP_NAME__', ok: true }))
    app.get('/health', async () => ({ ok: true }))
    app.post('/ask', async (request, reply) => {
      const question = request.body?.question
      if (typeof question !== 'string') return reply.code(400).send({ error: 'question must be a string' })
      return agent.run(question)
    })
    ctx.provide('routes.ready', true)
  },
}
