import { createInterface } from 'node:readline/promises'
import type { Options } from './args'
import { isValidName, nameFrom } from './copy'
import type { Host } from './templates'

/** Ask for anything the flags did not give. Only called on an interactive terminal without `--yes`. */
export async function ask(options: Options, directory: string): Promise<{ name: string; host: Host; agent: boolean; install: boolean }> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    let name = options.name ?? nameFrom(directory)
    if (options.name === undefined) {
      const answer = (await rl.question(`Project name (${name}): `)).trim()
      if (answer) name = answer
    }
    let host = options.host
    if (host === undefined) {
      const answer = (await rl.question('Host - hono or fastify (hono): ')).trim().toLowerCase()
      host = answer === 'fastify' ? 'fastify' : 'hono'
    }
    let agent = options.agent
    if (agent === undefined) {
      const answer = (await rl.question('Include the offline agent starter? (y/N): ')).trim().toLowerCase()
      agent = answer === 'y' || answer === 'yes'
    }
    let install = options.install
    if (!options.install) {
      const answer = (await rl.question('Install dependencies now with pnpm? (y/N): ')).trim().toLowerCase()
      install = answer === 'y' || answer === 'yes'
    }
    return { name, host, agent, install }
  } finally {
    rl.close()
  }
}

/** Defaults for `--yes` (and for non-interactive runs). */
export function defaults(options: Options, directory: string): { name: string; host: Host; agent: boolean; install: boolean } {
  return { name: options.name ?? nameFrom(directory), host: options.host ?? 'hono', agent: options.agent ?? false, install: options.install }
}

export { isValidName }
