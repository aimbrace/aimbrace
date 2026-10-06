import { definePlugin } from '@aimbrace/core'

const inline = definePlugin({ id: 'inline' })

// defineConfig is an identity function, so a plain object is equivalent.
export default {
  name: 'from-module',
  plugins: ['./plugins/hello.mjs', inline],
}
