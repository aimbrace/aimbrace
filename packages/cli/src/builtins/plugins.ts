import { discoverPlugins } from '@aimbrace/loader'
import type { Builtin } from './shared'

/** `aimbrace plugins`: list installed packages that declare an AIMBRACE plugin entry. */
export const pluginsCommand: Builtin = async (ctx) => {
  const found = discoverPlugins(ctx.cwd)
  if (found.length === 0) {
    ctx.io.stdout.write(
      'No installed plugins found (packages with an "aimbrace": { "plugin": ... } field).\n',
    )
    return 0
  }
  const width = Math.max(...found.map((plugin) => plugin.name.length))
  for (const plugin of found) {
    ctx.io.stdout.write(
      `${plugin.name.padEnd(width)}  ${(plugin.version ?? '').padEnd(8)}  ${plugin.description ?? ''}\n`.trimEnd() +
        '\n',
    )
  }
  return 0
}
