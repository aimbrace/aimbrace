import { definePlugin } from '@aimbrace/core'

export default function factory(options = { label: 'default' }) {
  return definePlugin({ id: `factory-${options.label}` })
}
