import { definePlugin, service } from '@aimbrace/core'

export const Greeter = service('greeter')

export default definePlugin({
  id: 'greeter',
  version: '1.0.0',
  provides: [Greeter],
  setup(ctx) {
    ctx.provide(Greeter, {
      greet: (name, loud) => (loud ? `HELLO, ${name.toUpperCase()}!` : `Hello, ${name}!`),
    })
  },
})
