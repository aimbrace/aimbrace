import { commandsPlugin } from '@aimbrace/cli'
import { Greeter } from './greeter.mjs'

export default commandsPlugin('fixture-commands', [
  {
    name: 'greet',
    description: 'Greet someone',
    usage: 'greet <name> [--loud]',
    options: { loud: { type: 'boolean', short: 'l' } },
    run(ctx) {
      const [name] = ctx.args
      if (!name) {
        ctx.stderr.write('greet needs a name\n')
        return 2
      }
      ctx.stdout.write(`${ctx.scope.get(Greeter).greet(name, ctx.values.loud === true)}\n`)
    },
  },
  { name: 'fail', description: 'Always exits 3', run: () => 3 },
  {
    name: 'crash',
    run() {
      throw new Error('command exploded')
    },
  },
])
