import { definePlugin, type Plugin } from '@aimbrace/core'
import { createDispatcher } from './dispatch'
import { HttpDispatcher, Middlewares, Routes } from './tokens'
import type { Handler, HttpMethod, MiddlewareEntry, Route } from './types'

/**
 * The HTTP core plugin: provides the {@link HttpDispatcher} over the live
 * `Routes` and `Middlewares` registries. Host plugins require it.
 */
export const http = definePlugin({
  id: 'http',
  version: '0.1.0',
  description: 'Routes and middleware on Web Request and Response, with a scope per request',
  provides: [HttpDispatcher],
  setup(ctx) {
    ctx.provide(
      HttpDispatcher,
      createDispatcher({
        ctx,
        routes: ctx.registry(Routes),
        middleware: ctx.registry(Middlewares),
        report: (error, where) => ctx.report(error, where),
      }),
    )
  },
})

/** Create a route. */
export function route(
  method: Route['method'],
  path: string,
  handler: Handler,
  options: { name?: string } = {},
): Route {
  return { method, path, handler, name: options.name }
}

const verb =
  (method: HttpMethod) =>
  (path: string, handler: Handler, options?: { name?: string }): Route =>
    route(method, path, handler, options)

/** Route shorthands. */
export const get = verb('GET')
export const post = verb('POST')
export const put = verb('PUT')
export const patch = verb('PATCH')
export const del = verb('DELETE')

/**
 * A plugin that only contributes routes (and optionally middleware). It does
 * not import any host: it works under every host adapter.
 */
export function routesPlugin(
  id: string,
  routes: readonly Route[],
  options: { middleware?: readonly MiddlewareEntry[] } = {},
): Plugin {
  return definePlugin({
    id,
    setup(ctx) {
      for (const entry of routes) ctx.registry(Routes).add(entry)
      for (const entry of options.middleware ?? []) ctx.registry(Middlewares).add(entry)
    },
  }) as unknown as Plugin
}
