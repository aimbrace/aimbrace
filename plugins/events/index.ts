/**
 * Events as a stream (`GET /events`, server-sent events). A client connects once and receives every change as it happens: the
 * event name is the Cordis event (`tasks/changed`, `extensions/changed`, any you list), the data is `{ "args": [...] }` with the
 * event's arguments as JSON. Desktop, web and terminal surfaces can all render the same stream (the Pi Durable "one place to
 * observe" idea); nothing here knows about tasks or extensions. Each connection's listeners are removed when the client leaves.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '../http/index.ts'

export interface EventsConfig {
  /** Cordis events to stream. */
  topics?: readonly string[]
  /** Where the stream is served. Default `/events`. */
  path?: string
}

export const events = {
  name: 'events',
  inject: ['http'],
  apply(ctx: Context, config?: EventsConfig) {
    const topics = config?.topics ?? []
    const path = config?.path ?? '/events'
    const listen = ctx.on as unknown as (
      topic: string,
      listener: (...args: unknown[]) => void,
    ) => () => void
    ctx.effect(() =>
      ctx.http.route('GET', path, () => ({
        body: null,
        stream: (send) => {
          const leaves = topics.map((topic) =>
            listen.call(ctx, topic, (...args: unknown[]) => send(topic, { args })),
          )
          send('connected', { topics })
          return () => {
            for (const leave of leaves) leave()
          }
        },
      })),
    )
  },
}
