import { createServer } from 'node:http'

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (chunks.length === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Serves the `http` router over Node's own `node:http`. The returned disposer closes the server when this plugin is
 * disposed. No HTTP library is needed: add Hono or Fastify inside this plugin only if your app outgrows it.
 */
export const server = {
  name: 'server',
  inject: ['http', 'config'],
  async apply(ctx) {
    const router = ctx.get('http')
    const { port, hostname } = ctx.get('config')
    const listener = createServer(async (request, response) => {
      const send = (status, body) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(body))
      }
      try {
        let body
        try {
          body = await readJson(request)
        } catch {
          return send(400, { error: 'invalid JSON' })
        }
        const path = new URL(request.url ?? '/', 'http://localhost').pathname
        const result = await router.handle({ method: request.method ?? 'GET', path, body })
        send(result.status, result.body)
      } catch (error) {
        send(500, { error: error instanceof Error ? error.message : String(error) })
      }
    })
    await new Promise((resolve, reject) => {
      listener.once('error', reject)
      listener.listen(port, hostname, resolve)
    })
    const address = listener.address()
    ctx.provide('http.address', {
      hostname: address.address,
      port: address.port,
      url: `http://${address.address}:${address.port}`,
    })
    return () => new Promise((done) => listener.close(() => done()))
  },
}
