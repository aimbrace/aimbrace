import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

/** Thrown when the target directory exists and is not empty. Nothing has been written. */
export class TargetNotEmptyError extends Error {
  constructor(readonly target: string) {
    super(
      `refusing to write into "${target}": the directory is not empty. Choose an empty or new directory.`,
    )
    this.name = 'TargetNotEmptyError'
  }
}

/** A project name npm accepts: lower case letters, digits and dashes, starting with a letter. */
export function isValidName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name) && name.length <= 214
}

/** A valid default project name derived from a directory path. */
export function nameFrom(directory: string): string {
  const base = directory.split(/[\\/]/).filter(Boolean).pop() ?? ''
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
  return cleaned || 'my-app'
}

/** Refuse a target that exists and is not an empty directory. A missing target is fine: it is created. */
export function assertTargetFree(target: string): void {
  if (!existsSync(target)) return
  if (!statSync(target).isDirectory() || readdirSync(target).length > 0)
    throw new TargetNotEmptyError(target)
}

/**
 * Copy a template into `target`, replacing `__APP_NAME__` with `name`. Checks the target before writing anything.
 *
 * @returns the copied files, relative to `target`
 */
export function copyTemplate(source: string, target: string, name: string): string[] {
  assertTargetFree(target)
  mkdirSync(target, { recursive: true })
  const written: string[] = []
  const walk = (from: string, to: string, prefix: string) => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const sourcePath = join(from, entry.name)
      const targetPath = join(to, entry.name)
      if (entry.isDirectory()) {
        mkdirSync(targetPath, { recursive: true })
        walk(sourcePath, targetPath, `${prefix}${entry.name}/`)
        continue
      }
      const text = readFileSync(sourcePath, 'utf8')
      if (text.includes('__APP_NAME__'))
        writeFileSync(targetPath, text.replaceAll('__APP_NAME__', name))
      else cpSync(sourcePath, targetPath)
      written.push(`${prefix}${entry.name}`)
    }
  }
  walk(source, target, '')
  return written
}
