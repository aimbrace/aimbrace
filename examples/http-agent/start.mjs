#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { HttpAddress } from '@aimbrace/http'
import { createServer } from './src/server.mjs'

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: 'hono' },
    port: { type: 'string', default: '3000' },
  },
})
if (!['hono', 'fastify'].includes(values.host)) {
  console.error(`--host must be "hono" or "fastify", got "${values.host}"`)
  process.exit(2)
}

const app = await createServer({ host: values.host, port: Number(values.port) })
await app.start()
console.log(`${app.name} listening on ${app.get(HttpAddress).url}`)
console.log(
  '  POST /ask {"question":"calc: 2 + 3 * 4"}   GET /tools   GET /health   POST /ask/stream',
)

const stop = async () => {
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
  await app.stop()
  console.log('stopped')
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
