/**
 * The builder's commands for the offline scripted model, so the whole build-install-update-remove loop runs without a network.
 * A real model reads the tool descriptions instead and decides for itself.
 *
 *   create route <name> <path> <text...>   write a plugin that answers GET <path> with { text }, then install it
 *   update route <name> <path> <text...>   the same, over the existing plugin
 *   break plugin <name>                     write a version whose apply throws, then try to install it
 *   remove plugin <name>                    remove it and delete its folder
 *   list plugins                            list installed extensions
 */
import type { Rule, Step } from '../agent/index.ts'

const PATH = /^\/[a-z0-9/-]*$/

export function routeSource(name: string, path: string, text: string): string {
  return `import type { Context } from '@deepseek-ai/cordis'

/** Written by the builder: answers GET ${path}, and checks that it does before the install counts. */
export const name = '${name}'
export const inject = ['http']

interface Http {
  route(method: string, path: string, handler: () => { body: unknown }): () => void
  handle(request: { method: string; path: string; body: unknown }): Promise<{ status: number; body: unknown }>
}

export function apply(ctx: Context) {
  const http = ctx.get('http') as Http
  ctx.effect(() => http.route('GET', ${JSON.stringify(path)}, () => ({ body: { text: ${JSON.stringify(text)} } })))
}

export async function check(ctx: Context) {
  const reply = await (ctx.get('http') as Http).handle({ method: 'GET', path: ${JSON.stringify(path)}, body: undefined })
  if (reply.status !== 200) throw new Error(\`GET ${path} answered \${reply.status}\`)
}
`
}

export function brokenSource(name: string): string {
  return `export const name = '${name}'

export function apply() {
  throw new Error('${name} refuses to start')
}
`
}

function summary(result: unknown): string {
  const answer = result as {
    ok?: boolean
    name?: string
    action?: string
    state?: string
    errors?: string[]
    restoredPrevious?: boolean
  }
  if (answer?.ok === true && answer.action)
    return `${answer.name}: ${answer.action}, ${answer.state}.`
  if (answer?.ok === true) return `${answer.name}: done.`
  const restored =
    answer?.restoredPrevious === undefined
      ? ''
      : ` Previous version restored: ${String(answer.restoredPrevious)}.`
  return `Refused: ${(answer?.errors ?? ['unknown error']).join('; ')}.${restored}`
}

/** Write, then install, then report. */
function writeThenInstall(
  step: number,
  toolResult: unknown,
  name: string,
  files: Record<string, string>,
): Step {
  if (step === 0) return { tool: 'write_plugin', input: { name, files } }
  if (step === 1) {
    const written = toolResult as { ok?: boolean; error?: string }
    if (written?.ok !== true)
      return { text: `Could not write ${name}: ${written?.error ?? 'unknown error'}` }
    return { tool: 'install_plugin', input: { name } }
  }
  return { text: summary(toolResult) }
}

export const builderRules: Rule = ({ question, step, toolResult }) => {
  const words = question.trim().split(/\s+/)
  const [verb, noun, name, path, ...text] = words
  if (
    (verb === 'create' || verb === 'update') &&
    noun === 'route' &&
    name &&
    path &&
    PATH.test(path)
  ) {
    return writeThenInstall(step, toolResult, name, {
      'index.ts': routeSource(name, path, text.join(' ') || name),
    })
  }
  if (verb === 'break' && noun === 'plugin' && name)
    return writeThenInstall(step, toolResult, name, { 'index.ts': brokenSource(name) })
  if (verb === 'remove' && noun === 'plugin' && name) {
    return step === 0
      ? { tool: 'remove_plugin', input: { name, deleteSource: true } }
      : { text: summary(toolResult) }
  }
  if (verb === 'list' && noun === 'plugins') {
    if (step === 0) return { tool: 'list_plugins', input: {} }
    const installed =
      (toolResult as { installed?: Array<{ name: string; state: string }> })?.installed ?? []
    return {
      text: installed.length
        ? installed.map((entry) => `${entry.name} (${entry.state})`).join(', ')
        : 'No plugins installed.',
    }
  }
  return undefined
}
