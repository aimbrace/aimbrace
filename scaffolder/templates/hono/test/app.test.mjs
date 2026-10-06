import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.mjs'

let app
afterEach(async () => {
  await app?.stop()
  app = undefined
})

describe('__APP_NAME__', () => {
  it('serves the index route on a free port', async () => {
    app = await createApp({ port: 0 })
    const response = await fetch(`${app.url}/`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ app: '__APP_NAME__', ok: true }))
  })

  it('answers health checks', async () => {
    app = await createApp({ port: 0 })
    expect((await fetch(`${app.url}/health`)).status).toBe(200)
  })

  it('returns 404 for unknown paths', async () => {
    app = await createApp({ port: 0 })
    expect((await fetch(`${app.url}/nope`)).status).toBe(404)
  })

})
