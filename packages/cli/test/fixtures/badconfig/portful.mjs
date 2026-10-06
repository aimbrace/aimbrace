import { definePlugin } from '@aimbrace/core'

const schema = {
  '~standard': {
    version: 1,
    vendor: 'fixture',
    validate: (value) =>
      typeof value?.port === 'number'
        ? { value }
        : { issues: [{ message: 'expected a number', path: ['port'] }] },
  },
}

export default definePlugin({
  id: 'portful',
  config: schema,
  setup() {
    throw new Error('setup must not run during check')
  },
})
