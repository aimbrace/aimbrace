import { definePlugin, service } from '@aimbrace/core'

export default definePlugin({ id: 'needy', requires: [service('ghost')] })
