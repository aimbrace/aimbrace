import { createApp } from '@aimbrace/core'
import { http } from '@aimbrace/http'
import agent from '@aimbrace/plugin-agent'
import memory from '@aimbrace/plugin-memory'
import model, { mockModel } from '@aimbrace/plugin-model'
import tools, { builtinTools } from '@aimbrace/plugin-tools'
import { agentRoutes } from './routes.mjs'

/**
 * The whole system as a plugin list. Only one line differs between hosts.
 *
 * @param {{ host?: 'hono' | 'fastify', port?: number, delayMs?: number }} options
 */
export async function createServer({ host = 'hono', port = 3000, delayMs = 0 } = {}) {
  const hostPlugin =
    host === 'fastify'
      ? (await import('@aimbrace/fastify')).fastifyHost({ port })
      : (await import('@aimbrace/hono')).honoHost({ port })
  return createApp({
    name: `http-agent (${host})`,
    plugins: [
      model,
      memory,
      tools,
      builtinTools,
      mockModel({ delayMs }),
      agent,
      http,
      hostPlugin,
      agentRoutes,
    ],
  })
}
