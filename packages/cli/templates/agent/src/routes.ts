import type { Context } from '@deepseek-ai/cordis'
import type {} from './plugins/agent/index.ts'
import type {} from './plugins/extensions/index.ts'
import type {} from './plugins/http/index.ts'

export const APP_NAME = '__APP_NAME__'

/** The app's own routes, including `POST /ask` for the agent and `GET /extensions`. Each one lives in a `ctx.effect`. */
export const routes = {
  name: 'routes',
  inject: ['http', 'agent', 'extensions'],
  apply(ctx: Context) {
    ctx.effect(() => ctx.http.route('GET', '/', () => ({ body: { app: APP_NAME, ok: true } })))
    ctx.effect(() => ctx.http.route('GET', '/health', () => ({ body: { ok: true } })))
    ctx.effect(() =>
      ctx.http.route('GET', '/extensions', () => ({
        body: { installed: ctx.extensions.list(), notInstalled: ctx.extensions.pending() },
      })),
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
