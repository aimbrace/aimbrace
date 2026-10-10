import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { http } from '../../http/index.ts'
import { server } from '../../server/index.ts'
import { events } from '../index.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'test/changed'(value: number): void
  }
}

async function boot() {
  const root = new Context()
  const fibers = [
    root.plugin(http),
    root.plugin(events, { topics: ['test/changed'] }),
    root.plugin(server, { port: 0 }),
  ]
  for (const fiber of fibers) await fiber.await()
  return { root, fibers }
}

/** Read server-sent events from a response until `want` events arrived. */
async function read(response: Response, want: number) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const found: Array<{ id: string; event: string; data: unknown }> = []
  while (found.length < want) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    for (const block of text.split('\n\n').slice(0, -1)) {
      const fields = Object.fromEntries(
        block
          .split('\n')
          .filter((line) => /^\w+: /.test(line))
          .map((line) => [line.split(': ')[0], line.slice(line.indexOf(': ') + 2)]),
      )
      if (fields.event && !found.some((event) => event.id === fields.id))
        found.push({ id: fields.id, event: fields.event, data: JSON.parse(fields.data) })
    }
  }
  await reader.cancel()
  return found
}

test('a client receives each Cordis event as it happens, with rising ids', async () => {
  const { root, fibers } = await boot()
  const controller = new AbortController()
  const response = await fetch(`${root.server.url}/events`, { signal: controller.signal })
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  const received = read(response, 3)
  await new Promise((done) => setTimeout(done, 50))
  root.emit('test/changed', 1)
  root.emit('test/changed', 2)
  const events = await received
  assert.deepEqual(
    events.map((event) => [event.id, event.event]),
    [
      ['1', 'connected'],
      ['2', 'test/changed'],
      ['3', 'test/changed'],
    ],
  )
  assert.deepEqual(
    events.slice(1).map((event) => event.data),
    [{ args: [1] }, { args: [2] }],
  )
  controller.abort()
  for (const fiber of [...fibers].reverse()) await fiber.dispose()
})

test('when a client leaves, its listener is removed; stopping the server ends a stream that is still open', async () => {
  const { root, fibers } = await boot()
  const emitted: number[] = []
  root.on('test/changed', (value) => void emitted.push(value))
  const first = await fetch(`${root.server.url}/events`)
  await read(first, 1)
  await new Promise((done) => setTimeout(done, 50))
  root.emit('test/changed', 7)
  assert.deepEqual(emitted, [7])

  const open = await fetch(`${root.server.url}/events`)
  const reader = open.body!.getReader()
  await reader.read()
  for (const fiber of [...fibers].reverse()) await fiber.dispose()
  const ended = await reader.read().then(
    (chunk) => chunk.done,
    () => true,
  )
  assert.equal(ended, true)
})
