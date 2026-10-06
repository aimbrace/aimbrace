import { resolve } from 'node:path'
import { AimbraceError, type App } from '@aimbrace/core'
import { loadApp } from '@aimbrace/loader'
import { UsageError } from '../args'
import type { Io } from '../io'

/** What a built-in command receives. */
export interface BuiltinContext {
  args: readonly string[]
  /** The resolved `--config` value, when given. */
  config: string | undefined
  /** Directory the command works in (`--cwd` or the process directory). */
  cwd: string
  io: Io
  debug: boolean
}

export type Builtin = (ctx: BuiltinContext) => Promise<number>

/** Load the app described by the project config (not started). */
export function loadProjectApp(ctx: BuiltinContext): Promise<App> {
  return loadApp(ctx.config ? resolve(ctx.cwd, ctx.config) : ctx.cwd)
}

/** `error: message`, the AIMBRACE error code when there is one, and the cause chain. */
export function formatError(error: unknown, debug: boolean): string {
  if (error instanceof UsageError)
    return `error: ${error.message}\nRun "aimbrace help" for usage.\n`
  const lines: string[] = []
  let current: unknown = error
  let first = true
  while (current instanceof Error) {
    const code = current instanceof AimbraceError ? ` [${current.code}]` : ''
    lines.push(`${first ? 'error' : 'caused by'}: ${current.message.split('\n')[0]}${code}`)
    if (current instanceof Error && 'cause' in current && current.cause !== current)
      current = current.cause
    else break
    first = false
  }
  if (lines.length === 0) lines.push(`error: ${String(error)}`)
  if (debug && error instanceof Error && error.stack) lines.push('', error.stack)
  return `${lines.join('\n')}\n`
}
