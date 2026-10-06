import { definePlugin, service } from '@aimbrace/core'

const Port = service('port')
const schema = {
  '~standard': {
    version: 1,
    vendor: 'fixture',
    validate: (value) => ({ value: { port: value?.port ?? 3000 } }),
  },
}

export const plugin = definePlugin({
  id: 'configured',
  config: schema,
  provides: [Port],
  setup(ctx, config) {
    ctx.provide(Port, config.port)
  },
})
