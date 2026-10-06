import { get, HttpError, json, post, routesPlugin } from '@aimbrace/http'
import { Agent } from '@aimbrace/plugin-agent'
import { ToolRunner } from '@aimbrace/plugin-tools'

async function readBody(ctx) {
  let body
  try {
    body = await ctx.request.json()
  } catch {
    throw new HttpError(400, 'The body must be JSON.')
  }
  if (typeof body?.question !== 'string' || body.question.trim() === '') {
    throw new HttpError(400, '"question" must be a non-empty string.')
  }
  return body
}

/**
 * Routes only: no import of Hono or Fastify. The same plugin runs under every host.
 *
 * Each request has a scope (`ctx.scope`). `/ask` hands the request id and signal to the agent, so the
 * agent's task scope is linked to the request: a client that disconnects cancels the run.
 */
export const agentRoutes = routesPlugin('agent-routes', [
  get('/health', () => json({ ok: true })),

  get('/tools', (ctx) => json({ tools: ctx.scope.get(ToolRunner).list() })),

  post('/ask', async (ctx) => {
    const { question, budget, steps } = await readBody(ctx)
    const result = await ctx.scope.get(Agent).run(question, {
      id: ctx.id,
      signal: ctx.signal,
      ...(typeof budget === 'number' ? { budgetTokens: budget } : {}),
      ...(typeof steps === 'number' ? { maxSteps: steps } : {}),
    })
    return json({
      status: result.status,
      output: result.output ?? null,
      usage: result.usage,
      steps: result.steps,
    })
  }),

  // Server-Sent Events: every agent step is pushed as it happens.
  post('/ask/stream', async (ctx) => {
    const { question } = await readBody(ctx)
    const encoder = new TextEncoder()
    let controller
    let closed = false
    const stream = new ReadableStream({
      start(c) {
        controller = c
      },
      cancel() {
        closed = true
      },
    })
    const send = (event, data) => {
      if (!closed)
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    }
    const finish = () => {
      if (!closed) {
        closed = true
        controller.close()
      }
    }
    // A hook registered through the request scope is removed when the request ends.
    ctx.scope.hooks.hook('agent:step', ({ id, step }) => {
      if (id === ctx.id) send('step', step)
    })
    ctx.scope
      .get(Agent)
      .run(question, { id: ctx.id, signal: ctx.signal })
      .then(
        (result) => {
          send('done', { status: result.status, output: result.output ?? null })
          finish()
        },
        (error) => {
          send('error', { message: error.message })
          finish()
        },
      )
    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
    })
  }),
])
