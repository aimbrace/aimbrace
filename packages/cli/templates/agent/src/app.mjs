import { Context } from '@deepseek-ai/cordis'
import { agent } from './plugins/agent.mjs'
import { http } from './plugins/http.mjs'
import { memory } from './plugins/memory.mjs'
import { model } from './plugins/model.mjs'
import { routes } from './plugins/routes.mjs'
import { server } from './plugins/server.mjs'
import { tools } from './plugins/tools.mjs'

/**
 * The whole app, as Cordis plugins on one root context. `inject` decides when each plugin can start: the agent's model,
 * tools and memory, then the agent, the router, the routes and the server.
 */
export async function createApp({ port = 3000, hostname = '127.0.0.1' } = {}) {
  const root = new Context()
  root.provide('config', { port, hostname })
  const fibers = [
    root.plugin(model),
    root.plugin(tools),
    root.plugin(memory),
    root.plugin(agent),
    root.plugin(http),
    root.plugin(routes),
    root.plugin(server),
  ]
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
