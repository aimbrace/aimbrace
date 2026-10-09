/**
 * A staged extension lives in the app's home, which may be anywhere (a pinned home in a temporary folder), so a bare import such as
 * `@deepseek-ai/cordis` would not find the app's `node_modules`. This resolve hook leaves resolution alone, and only when it fails for a
 * module inside the staging folder, resolves the same name from the app's project folder. Uses Node's public `module.registerHooks`
 * (ACRYL needed the same fallback on Deno); the returned function removes the hook.
 */
import { mkdirSync, realpathSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const isBare = (specifier: string) => !/^[./]/.test(specifier) && !specifier.includes(':')

export function resolveFromApp(stageRoot: string, appRoot: string): () => void {
  mkdirSync(stageRoot, { recursive: true })
  const staged = pathToFileURL(`${realpathSync(stageRoot)}/`).href
  const parentURL = pathToFileURL(join(realpathSync(appRoot), 'package.json')).href
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context)
      } catch (error) {
        if (isBare(specifier) && context.parentURL?.startsWith(staged))
          return nextResolve(specifier, { ...context, parentURL })
        throw error
      }
    },
  })
  return () => hook.deregister()
}
