import type { Context } from '@deepseek-ai/cordis'
import type {} from './plugins/agent/index.ts'
import type {} from './plugins/extensions/index.ts'
import type {} from './plugins/http/index.ts'
import type {} from './plugins/tasks/index.ts'

export const APP_NAME = '__APP_NAME__'

/**
 * The app's own routes: `POST /ask` for the agent; `GET /extensions` and `GET /tasks` to observe what it did (every run is a durable
 * task owning one task per tool call); `POST /tasks/cancel`. Each route lives in a `ctx.effect`.
 */
export const routes = {
  name: 'routes',
  inject: ['http', 'agent', 'extensions', 'tasks'],
  apply(ctx: Context) {
    ctx.effect(() => ctx.http.route('GET', '/', () => ({ body: { app: APP_NAME, ok: true } })))
    ctx.effect(() => ctx.http.route('GET', '/health', () => ({ body: { ok: true } })))
    ctx.effect(() =>
      ctx.http.route('GET', '/extensions', () => ({
        body: { installed: ctx.extensions.list(), notInstalled: ctx.extensions.pending() },
      })),
    )
    ctx.effect(() =>
      ctx.http.route('GET', '/tasks', () => ({ body: ctx.tasks.list().slice(0, 100) })),
    )
    ctx.effect(() =>
      ctx.http.route('POST', '/tasks/cancel', ({ body }) => {
        const id = (body as { id?: unknown } | undefined)?.id
        if (typeof id !== 'string' || !ctx.tasks.get(id))
          return { status: 404, body: { error: 'no such task' } }
        return { body: { cancelled: ctx.tasks.cancel(id) } }
      }),
    )
    ctx.effect(() =>
      ctx.http.route('POST', '/ask', async ({ body }) => {
        const question = (body as { question?: unknown } | undefined)?.question
        if (typeof question !== 'string')
          return { status: 400, body: { error: 'question must be a string' } }
        return { body: await ctx.agent.run(question) }
      }),
    )
  },
}
