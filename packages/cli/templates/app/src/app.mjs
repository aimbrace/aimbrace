import { Context } from '@deepseek-ai/cordis'
import { http } from './plugins/http.mjs'
import { routes } from './plugins/routes.mjs'
import { server } from './plugins/server.mjs'

/**
 * The whole app, as Cordis plugins on one root context. `inject` decides when each plugin can start: the router first,
 * then the routes and the server, which both need it.
 */
export async function createApp({ port = 3000, hostname = '127.0.0.1' } = {}) {
  const root = new Context()
  root.provide('config', { port, hostname })
  const fibers = [root.plugin(http), root.plugin(routes), root.plugin(server)]
  // Await in dependency order: a fiber still PENDING on an injected service reports done too early.
  for (const fiber of fibers) await fiber.await()
  if (!root.get('http.address')) throw new Error('the server did not start')
  return {
    root,
    get url() {
      return root.get('http.address')?.url
    },
    async stop() {
      for (const fiber of [...fibers].reverse()) await fiber.dispose()
    },
  }
}
