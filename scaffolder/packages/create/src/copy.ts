import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Placeholders the templates contain, and what replaces them. */
export interface Values {
  name: string
  hostLabel: string
}

const PLACEHOLDERS = ['__APP_NAME__', '__HOST_LABEL__'] as const

/** Thrown when the target directory exists and already has content. Nothing is written. */
export class TargetNotEmptyError extends Error {
  readonly target: string
  constructor(target: string) {
    super(`refusing to write into "${target}": the directory is not empty. Choose an empty or new directory.`)
    this.name = 'TargetNotEmptyError'
    this.target = target
  }
}

/** Refuse a target that exists and has any entries. A missing target is fine (it is created). */
export function assertTargetFree(target: string): void {
  if (!existsSync(target)) return
  if (!statSync(target).isDirectory()) throw new TargetNotEmptyError(target)
  if (readdirSync(target).length > 0) throw new TargetNotEmptyError(target)
}

function substitute(text: string, values: Values): string {
  return text.replaceAll('__APP_NAME__', values.name).replaceAll('__HOST_LABEL__', values.hostLabel)
}

/** Copy a template folder into `target`, replacing the placeholders in every text file. Throws before writing if the target is not free. */
export function copyTemplate(source: string, target: string, values: Values): string[] {
  assertTargetFree(target)
  mkdirSync(target, { recursive: true })
  const written: string[] = []
  const walk = (from: string, to: string) => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const sourcePath = join(from, entry.name)
      const targetPath = join(to, entry.name)
      if (entry.isDirectory()) {
        mkdirSync(targetPath, { recursive: true })
        walk(sourcePath, targetPath)
        continue
      }
      const text = readFileSync(sourcePath, 'utf8')
      if (PLACEHOLDERS.some((placeholder) => text.includes(placeholder))) {
        writeFileSync(targetPath, substitute(text, values))
      } else {
        cpSync(sourcePath, targetPath)
      }
      written.push(targetPath)
    }
  }
  walk(source, target)
  return written.map((path) => path.slice(target.length + 1))
}

/** A project name npm accepts: lower case, digits and dashes, starting with a letter. */
export function isValidName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name) && name.length <= 214
}

/** A safe default name from a directory name. */
export function nameFrom(directory: string): string {
  const base = directory.split(/[\\/]/).filter(Boolean).pop() ?? 'my-app'
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
  return cleaned || 'my-app'
}
