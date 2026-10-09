import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createApp } from '../src/app.ts'
import { pinnedInstance, withPort } from '../src/plugins/instance/index.ts'

/** The agent extends the running app through POST /ask; a restart keeps what it built. */
test('the agent builds, updates, protects and removes a plugin in the running app, and a restart keeps it', async () => {
  const project = await mkdtemp(join(tmpdir(), 'builder-project-'))
  const chosen = withPort(pinnedInstance(join(project, '.aimbrace'), { root: project }), 0)
  let app = await createApp(chosen)
  const ask = async (question: string) => {
    const response = await fetch(`${app.url}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    })
    return ((await response.json()) as { output: string }).output
  }
  const hello = async () => {
    const response = await fetch(`${app.url}/hello`)
    return response.status === 200
      ? ((await response.json()) as { text: string }).text
      : response.status
  }
  try {
    assert.equal(await ask('create route hello /hello Hello'), 'hello: installed, active.')
    assert.equal(await hello(), 'Hello')
    assert.equal(await ask('update route hello /hello Bonjour'), 'hello: updated, active.')
    assert.equal(await hello(), 'Bonjour')
    assert.match(await ask('break plugin hello'), /Previous version restored: true/)
    assert.equal(await hello(), 'Bonjour')

    // The broken version stays on disk, so put the working one back before restarting.
    await ask('update route hello /hello Bonjour')
    await app.stop()
    app = await createApp(chosen)
    assert.equal(await hello(), 'Bonjour')

    assert.equal(await ask('remove plugin hello'), 'hello: done.')
    assert.equal(await hello(), 404)

    // Every run is a durable task that owns its tool calls, and the records survived the restart.
    const records = (await (await fetch(`${app.url}/tasks`)).json()) as Array<{
      kind: string
      status: string
      parent?: string
    }>
    const runs = records.filter((record) => record.kind === 'agent-run')
    assert.equal(runs.length, 5)
    assert.ok(runs.every((run) => run.status === 'completed'))
    assert.ok(
      records.some(
        (record) => record.kind === 'tool:install_plugin' && record.parent !== undefined,
      ),
    )
  } finally {
    await app.stop()
    await rm(project, { recursive: true, force: true })
  }
})
