import { Context } from '@deepseek-ai/cordis'
import { http } from './plugins/http.ts'
import { routes } from './plugins/routes.ts'
import { server } from './plugins/server.ts'

export interface App {
  root: Context
  url: string
  stop(): Promise<void>
}

/**
 * The whole app, as Cordis plugins on one root context. `inject` decides when each plugin can start: the router
 * first, then the routes and the server, which both need it.
 */
export async function createApp({ port = 3000, hostname = '127.0.0.1' } = {}): Promise<App> {
  const root = new Context()
  const fibers = [root.plugin(http), root.plugin(routes), root.plugin(server, { port, hostname })]
  // Await in dependency order: a fiber still pending on an injected service reports done too early.
  for (const fiber of fibers) await fiber.await()
  const url = root.get('server')?.url
  if (!url) throw new Error('the server did not start')
  return {
    root,
    url,
    async stop() {
      for (const fiber of [...fibers].reverse()) await fiber.dispose()
    },
  }
}
