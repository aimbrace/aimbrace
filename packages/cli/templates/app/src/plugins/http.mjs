/**
 * The router service. Other plugins add routes with `http.route(method, path, handler)` inside `ctx.effect`, so a
 * route disappears when the plugin that added it is disposed. A handler gets `{ method, path, body }` and returns
 * `{ status, body }` (status defaults to 200).
 */
export function http(ctx) {
  const routes = new Map()
  ctx.provide('http', {
    route(method, path, handler) {
      const key = `${method} ${path}`
      if (routes.has(key)) throw new Error(`route ${key} is already registered`)
      routes.set(key, handler)
      return () => routes.delete(key)
    },
    async handle({ method, path, body }) {
      const handler = routes.get(`${method} ${path}`)
      if (!handler) return { status: 404, body: { error: 'not found' } }
      const result = await handler({ method, path, body })
      return { status: result.status ?? 200, body: result.body }
    },
  })
}
