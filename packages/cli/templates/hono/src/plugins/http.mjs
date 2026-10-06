import { Hono } from 'hono'

/** Provides the HTTP application. Routes are added to it by other plugins; nothing listens here. */
export function http(ctx) {
  ctx.provide('http.app', new Hono())
}
