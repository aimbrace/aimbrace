import type { Context } from '@deepseek-ai/cordis'

/** Where the server listens. Passed as this plugin's Cordis config. */
export interface ServerConfig {
  port: number
  hostname: string
}

/** The running server, provided once it listens. */
export interface Server {
  url: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    server: Server
  }
}

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const text = await request.text()
  if (text === '') return { ok: true, body: undefined }
  try {
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

/** Serves the `http` router with `Deno.serve`. The returned disposer shuts the server down. */
export const server = {
  name: 'server',
  inject: ['http'],
  apply(ctx: Context, config: ServerConfig) {
    const listener = Deno.serve(
      { port: config.port, hostname: config.hostname, onListen() {} },
      async (request) => {
        const parsed = await readJson(request)
        if (!parsed.ok) return Response.json({ error: 'invalid JSON' }, { status: 400 })
        try {
          const path = new URL(request.url).pathname
          const reply = await ctx.http.handle({ method: request.method, path, body: parsed.body })
          return Response.json(reply.body, { status: reply.status })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return Response.json({ error: message }, { status: 500 })
        }
      },
    )
    const { hostname, port } = listener.addr
    ctx.provide('server', { url: `http://${hostname}:${port}` } satisfies Server)
    return () => listener.shutdown()
  },
}
