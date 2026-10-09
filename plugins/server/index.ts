import { createServer, type IncomingMessage, type Server as NodeServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '../http/index.ts'

/** Where the server listens. Passed as this plugin's Cordis config. */
export interface ServerConfig {
  readonly port: number
  readonly hostname?: string
  /** Try the next port when this one is taken (up to 20 more). */
  readonly scan?: boolean
}

/** The running server, provided once it listens. */
export interface Server {
  readonly url: string
  readonly port: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    server: Server
  }
}

const SCAN_LIMIT = 20

async function readJson(
  request: IncomingMessage,
): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return { ok: true, body: undefined }
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { ok: false }
  }
}

function listen(listener: NodeServer, port: number, hostname: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      listener.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      listener.off('error', onError)
      resolve()
    }
    listener.once('error', onError)
    listener.once('listening', onListening)
    listener.listen(port, hostname)
  })
}

/** Serves the `http` router with Node's own `node:http`. The returned disposer closes the server. */
export const server = {
  name: 'server',
  inject: ['http'],
  async apply(ctx: Context, config: ServerConfig) {
    const hostname = config.hostname ?? '127.0.0.1'
    const listener = createServer(async (request, response) => {
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(body))
      }
      try {
        const parsed = await readJson(request)
        if (!parsed.ok) return send(400, { error: 'invalid JSON' })
        const path = new URL(request.url ?? '/', 'http://localhost').pathname
        const reply = await ctx.http.handle({
          method: request.method ?? 'GET',
          path,
          body: parsed.body,
        })
        send(reply.status, reply.body)
      } catch (error) {
        send(500, { error: error instanceof Error ? error.message : String(error) })
      }
    })
    const attempts = config.scan && config.port !== 0 ? SCAN_LIMIT + 1 : 1
    for (let attempt = 0; ; attempt++) {
      try {
        await listen(listener, config.port + attempt, hostname)
        break
      } catch (error) {
        const inUse = (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
        if (!inUse || attempt + 1 >= attempts) throw error
      }
    }
    const { port } = listener.address() as AddressInfo
    ctx.provide('server', { url: `http://${hostname}:${port}`, port } satisfies Server)
    return () =>
      new Promise<void>((done) => {
        listener.close(() => done())
        listener.closeAllConnections()
      })
  },
}
