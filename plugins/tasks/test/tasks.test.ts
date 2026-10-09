import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { instance, pinnedInstance } from '../../instance/index.ts'
import { tasks } from '../index.ts'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const step of cleanup.splice(0)) await step()
})

async function boot(home = mkdtempSync(join(tmpdir(), 'tasks-test-'))) {
  const root = new Context()
  const fibers = [root.plugin(instance, pinnedInstance(home)), root.plugin(tasks)]
  for (const fiber of fibers) await fiber.await()
  const stop = async () => {
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
  }
  return { root, home, stop }
}

test('a task is recorded before start returns, and its result before complete returns', async () => {
  const { root, home, stop } = await boot()
  cleanup.push(stop, () => rmSync(home, { recursive: true, force: true }))
  const task = root.tasks.start('build', { what: 'hello' })
  assert.match(readFileSync(join(home, 'tasks.jsonl'), 'utf8'), new RegExp(task.id))
  task.complete({ ok: true }, { steps: 2 })
  const record = root.tasks.get(task.id)
  assert.deepEqual(
    [record?.status, record?.result, record?.detail],
    ['completed', { ok: true }, { steps: 2 }],
  )
  task.fail('too late')
  assert.equal(root.tasks.get(task.id)?.status, 'completed')
})

test('cancelling a task cancels what it owns and aborts their signals', async () => {
  const { root, home, stop } = await boot()
  cleanup.push(stop, () => rmSync(home, { recursive: true, force: true }))
  const parent = root.tasks.start('run', {})
  const child = root.tasks.start('tool', {}, { parent: parent.id })
  assert.deepEqual(root.tasks.cancel(parent.id).sort(), [child.id, parent.id].sort())
  assert.equal(child.signal.aborted, true)
  assert.deepEqual(
    root.tasks.list({ parent: parent.id }).map((record) => record.status),
    ['cancelled'],
  )
  assert.throws(() => root.tasks.start('tool', {}, { parent: 'nobody' }), /no task/)
})

test('after a restart, records are back and work that was running is marked interrupted, not run again', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tasks-test-'))
  cleanup.push(() => rmSync(home, { recursive: true, force: true }))
  const first = await boot(home)
  const done = first.root.tasks.start('build', {})
  done.complete('ok')
  first.root.tasks.start('deploy', {})
  // Simulate a crash: the process ends without disposing, and the last line is torn.
  appendFileSync(join(home, 'tasks.jsonl'), '{"id":"torn"')
  const second = await boot(home)
  cleanup.push(second.stop)
  assert.equal(second.root.tasks.get(done.id)?.status, 'completed')
  assert.deepEqual(
    second.root.tasks.list({ status: 'interrupted' }).map((record) => record.kind),
    ['deploy'],
  )
  assert.equal(second.root.tasks.interrupted.length, 1)
  await first.stop()
})

test('stopping the app cancels running work and says so', async () => {
  const { root, home, stop } = await boot()
  cleanup.push(() => rmSync(home, { recursive: true, force: true }))
  const service = root.tasks
  const task = service.start('long', {})
  await stop()
  assert.equal(task.signal.aborted, true)
  assert.deepEqual(
    [service.get(task.id)?.status, service.get(task.id)?.error],
    ['cancelled', 'the app stopped'],
  )
})

test('every task carries the digest of the manifest the app was composed from', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tasks-test-'))
  cleanup.push(() => rmSync(home, { recursive: true, force: true }))
  const root = new Context()
  const fibers = [
    root.plugin(instance, pinnedInstance(home)),
    root.plugin(tasks, { manifest: 'sha256:abc' }),
  ]
  for (const fiber of fibers) await fiber.await()
  const task = root.tasks.start('build', {})
  assert.equal(root.tasks.get(task.id)?.manifest, 'sha256:abc')
  assert.match(readFileSync(join(home, 'tasks.jsonl'), 'utf8'), /"manifest":"sha256:abc"/)
  task.complete('ok')
  for (const fiber of [...fibers].reverse()) await fiber.dispose()
})
