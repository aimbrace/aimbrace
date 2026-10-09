import { createApp } from './app.mjs'

const app = await createApp({ port: Number(process.env.PORT ?? 3000) })
console.log(`__APP_NAME__ listening on ${app.url}`)

const stop = async () => {
  await app.stop()
  console.log('stopped')
  process.exit(0)
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
