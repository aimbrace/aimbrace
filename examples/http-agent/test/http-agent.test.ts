import { HttpAddress } from '@aimbrace/http'
import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from '../src/server.mjs'

type Server = Awaited<ReturnType<typeof createServer>>

const hosts = ['hono', 'fastify'] as const
const started: Server[] = []

afterEach(async () => {
  while (started.length > 0) {
    const app = started.pop() as Server
    await app.stop()
    expect(app.probe().clean).toBe(true)
  }
})

async function boot(host: (typeof hosts)[number], delayMs = 0) {
  const app = await createServer({ host, port: 0, delayMs })
  await app.start()
  started.push(app)
  const base = app.get(HttpAddress).url as string
  const ask = (question: string, extra: object = {}) =>
    fetch(`${base}/ask`, { method: 'POST', body: JSON.stringify({ question, ...extra }) })
  return { app, base, ask }
}

async function waitFor(check: () => boolean, timeout = 3000) {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function events(response: Response): Promise<Array<{ event: string; data: unknown }>> {
  const text = await response.text()
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const [event, data] = block.split('\n')
      return {
        event: (event as string).replace('event: ', ''),
        data: JSON.parse((data as string).replace('data: ', '')),
      }
    })
}

describe.each(hosts)('examples/http-agent on %s', (host) => {
  it('serves health and the tool list', async () => {
    const { base } = await boot(host)
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true })
    const tools = (await (await fetch(`${base}/tools`)).json()) as {
      tools: Array<{ name: string }>
    }
    expect(tools.tools.map((tool) => tool.name)).toEqual(['calculator', 'clock'])
  })

  it('answers a question with a tool call', async () => {
    const { ask } = await boot(host)
    const response = await ask('calc: 2 + 3 * 4')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      status: string
      output: string
      steps: unknown[]
      usage: { inputTokens: number }
    }
    expect(body).toMatchObject({ status: 'completed', output: 'The answer is 14.' })
    expect(body.steps).toHaveLength(3)
    expect(body.usage.inputTokens).toBeGreaterThan(0)
  })

  it('honours budget and step limits per request', async () => {
    const { ask } = await boot(host)
    expect(((await (await ask('loop', { steps: 2 })).json()) as { status: string }).status).toBe(
      'max_steps',
    )
    expect(
      ((await (await ask('loop', { budget: 5, steps: 9 })).json()) as { status: string }).status,
    ).toBe('budget_exceeded')
  })

  it('validates input and reports errors in one shape', async () => {
    const { base, ask } = await boot(host)
    const empty = await ask('   ')
    expect(empty.status).toBe(400)
    expect(await empty.json()).toEqual({ error: '"question" must be a non-empty string.' })
    const notJson = await fetch(`${base}/ask`, { method: 'POST', body: 'not json' })
    expect(notJson.status).toBe(400)
    expect(await notJson.json()).toEqual({ error: 'The body must be JSON.' })
    expect((await fetch(`${base}/missing`)).status).toBe(404)
    const wrong = await fetch(`${base}/ask`)
    expect(wrong.status).toBe(405)
    expect(wrong.headers.get('allow')).toBe('POST')
  })

  it('streams the steps as Server-Sent Events', async () => {
    const { base } = await boot(host)
    const response = await fetch(`${base}/ask/stream`, {
      method: 'POST',
      body: JSON.stringify({ question: 'calc: 6 * 7' }),
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const received = await events(response)
    expect(received.map((entry) => entry.event)).toEqual(['step', 'step', 'step', 'done'])
    expect(received[1]?.data).toMatchObject({ kind: 'tool', tool: 'calculator', summary: '42' })
    expect(received[3]?.data).toEqual({ status: 'completed', output: 'The answer is 42.' })
  })

  it('handles concurrent questions and leaves no scope behind', async () => {
    const { app, ask } = await boot(host)
    const answers = await Promise.all(
      Array.from(
        { length: 12 },
        async (_, n) => ((await (await ask(`calc: ${n} + 1`)).json()) as { output: string }).output,
      ),
    )
    expect(answers).toEqual(Array.from({ length: 12 }, (_, n) => `The answer is ${n + 1}.`))
    await waitFor(() => app.probe().scopes === 0)
  })

  it('cancels the agent run, and releases both scopes, when the client disconnects', async () => {
    const { app, base } = await boot(host, 5000)
    const statuses: string[] = []
    app.hooks.hook('agent:end', ({ status }) => void statuses.push(status))
    const client = new AbortController()
    const pending = fetch(`${base}/ask`, {
      method: 'POST',
      body: JSON.stringify({ question: 'hello' }),
      signal: client.signal,
    }).catch(() => 'aborted')
    await waitFor(() => app.probe().scopes === 2)
    expect(
      app
        .inspect()
        .scopes.map((scope) => scope.name)
        .sort(),
    ).toEqual([expect.stringMatching(/^request:/), expect.stringMatching(/^task:/)])
    client.abort()
    expect(await pending).toBe('aborted')
    await waitFor(() => statuses.length === 1)
    expect(statuses).toEqual(['cancelled'])
    await waitFor(() => app.probe().scopes === 0)
  })
})

/** The clock tool returns real time; everything else must match exactly. */
const normalise = (value: unknown) =>
  JSON.parse(JSON.stringify(value).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>'))

describe('the two hosts', () => {
  it('give identical answers to identical requests', async () => {
    const results: Record<string, unknown[]> = {}
    for (const host of hosts) {
      const { base, ask } = await boot(host)
      results[host] = [
        await (await ask('calc: 2 + 3 * 4')).json(),
        await (await ask('hello world')).json(),
        await (await ask('loop', { steps: 2 })).json(),
        await (await fetch(`${base}/tools`)).json(),
        await (await fetch(`${base}/nope`)).json(),
      ]
    }
    expect(normalise(results.fastify)).toEqual(normalise(results.hono))
  })

  it('share one plugin graph apart from the host plugin', async () => {
    const hono = await createServer({ host: 'hono', port: 0 })
    const fastify = await createServer({ host: 'fastify', port: 0 })
    const ids = (app: Server) =>
      app.graph().order.filter((id) => id !== 'hono-host' && id !== 'fastify-host')
    expect(ids(hono)).toEqual(ids(fastify))
    expect(hono.graph().order).toContain('hono-host')
    expect(fastify.graph().order).toContain('fastify-host')
  })
})
