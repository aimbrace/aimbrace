import { Context } from '@deepseek-ai/cordis'
import { http } from './plugins/http/index.ts'
import { type AppInstance, instance } from './plugins/instance/index.ts'
import { server } from './plugins/server/index.ts'
import { routes } from './routes.ts'

export interface App {
  readonly root: Context
  readonly url: string
  stop(): Promise<void>
}

/**
 * The whole app, as Cordis plugins on one root context. `inject` decides when each plugin can start; they are awaited in
 * dependency order because a fiber still waiting on an injected service reports done too early.
 */
export async function createApp(
  chosen: AppInstance,
  options: { hostname?: string } = {},
): Promise<App> {
  const root = new Context()
  const fibers = [
    root.plugin(instance, chosen),
    root.plugin(http),
    root.plugin(routes),
    root.plugin(server, {
      port: chosen.port.start,
      scan: chosen.port.scan,
      hostname: options.hostname ?? '127.0.0.1',
    }),
  ]
  for (const fiber of fibers) await fiber.await()
  return {
    root,
    url: root.server.url,
    async stop() {
      for (const fiber of [...fibers].reverse()) await fiber.dispose()
    },
  }
}
