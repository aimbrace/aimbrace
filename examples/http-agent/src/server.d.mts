import type { App } from '@aimbrace/core'

export interface ServerOptions {
  host?: 'hono' | 'fastify'
  /** `0` picks a free port. */
  port?: number
  /** Make the mock model slow, to exercise cancellation. */
  delayMs?: number
}

/** The whole system as a plugin list. Only the host plugin differs between `hono` and `fastify`. */
export function createServer(options?: ServerOptions): Promise<App>
