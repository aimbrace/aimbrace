import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { agent, memory, model, tools } from './plugins/agent/index.ts'
import { builder } from './plugins/builder/index.ts'
import { extensions } from './plugins/extensions/index.ts'
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
 * The whole app, as Cordis plugins on one root context, awaited in dependency order (a fiber still waiting on an injected service
 * reports done too early). `http` comes before `extensions`: installed extensions start again at boot and may add routes.
 */
export async function createApp(
  chosen: AppInstance,
  options: { hostname?: string } = {},
): Promise<App> {
  const root = new Context()
  // The app's own extensions folder: committed with the app, trusted to install at start, and where the builder writes.
  const extensionsDir = join(chosen.root, 'extensions')
  const fibers = [
    root.plugin(instance, chosen),
    root.plugin(model),
    root.plugin(tools),
    root.plugin(memory),
    root.plugin(agent),
    root.plugin(http),
    root.plugin(extensions, { sources: [{ dir: extensionsDir, trust: 'install' }] }),
    root.plugin(builder, { dir: extensionsDir }),
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
