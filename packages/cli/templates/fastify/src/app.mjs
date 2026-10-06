import { Context } from 'cordis'
import { http } from './plugins/http.mjs'
import { routes } from './plugins/routes.mjs'
import { server } from './plugins/server.mjs'

/**
 * The whole app, as Cordis plugins. Ordering comes from `inject`: the HTTP app first, routes on it next, the server
 * last. Nothing listens until every route is registered.
 */
export async function createApp({ port = 3000, hostname = '127.0.0.1' } = {}) {
  const root = new Context()
  root.provide('config', { port, hostname })
  const fibers = [root.plugin(http), root.plugin(routes), root.plugin(server)]
  // Wait in order: a fiber that is still PENDING (waiting on an injected service) reports done too early, so each one
  // is awaited after the plugin it depends on has activated.
  for (const fiber of fibers) await fiber.await()
  if (!root.get('http.address')) throw new Error('the server did not start')
  return {
    root,
    get url() {
      return root.get('http.address')?.url
    },
    async stop() {
      // Dispose in reverse order: the server first, then routes, then the app.
      for (const fiber of [...fibers].reverse()) await fiber.dispose()
    },
  }
}
