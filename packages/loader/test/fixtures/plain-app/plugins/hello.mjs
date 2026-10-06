import { definePlugin, service } from '@aimbrace/core'

export const Greeting = service('greeting')

export default definePlugin({
  id: 'hello',
  provides: [Greeting],
  setup(ctx) {
    ctx.provide(Greeting, 'hello from file')
  },
})
