import { createApp } from './app.ts'
import { APP_NAME } from './plugins/routes.ts'

const app = await createApp({ port: Number(Deno.env.get('PORT') ?? 3000) })
console.log(`${APP_NAME} listening on ${app.url}`)

const stop = async () => {
  await app.stop()
  console.log('stopped')
  Deno.exit(0)
}
Deno.addSignalListener('SIGINT', stop)
// Windows has no SIGTERM.
if (Deno.build.os !== 'windows') Deno.addSignalListener('SIGTERM', stop)
