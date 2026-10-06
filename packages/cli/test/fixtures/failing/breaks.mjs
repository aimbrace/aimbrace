import { definePlugin } from '@aimbrace/core'

export default definePlugin({
  id: 'breaks',
  setup() {
    throw new Error('cannot connect')
  },
})
