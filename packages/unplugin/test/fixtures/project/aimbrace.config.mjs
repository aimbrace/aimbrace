import { definePlugin, service } from '@aimbrace/core'

const Model = service('model')
const Agent = service('agent')

export default {
  name: 'fixture',
  plugins: [
    definePlugin({ id: 'agent', version: '1.0.0', requires: [Model], provides: [Agent] }),
    definePlugin({ id: 'openai-like', provides: [Model] }),
  ],
}
