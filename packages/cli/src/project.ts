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

/** A project name: lower case letters, digits and dashes, starting with a letter. */
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
export async function assertTargetFree(target: string): Promise<void> {
  let info: Deno.FileInfo
  try {
    info = await Deno.stat(target)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return
    throw error
  }
  if (!info.isDirectory) throw new TargetNotEmptyError(target)
  for await (const _ of Deno.readDir(target)) throw new TargetNotEmptyError(target)
}

/**
 * Copy a template into `target`, replacing `__APP_NAME__` with `name`. Checks the target before writing anything.
 *
 * @returns the copied files, relative to `target`
 */
export async function copyTemplate(source: URL, target: string, name: string): Promise<string[]> {
  await assertTargetFree(target)
  await Deno.mkdir(target, { recursive: true })
  const written: string[] = []
  const walk = async (from: URL, to: string, prefix: string) => {
    for await (const entry of Deno.readDir(from)) {
      const targetPath = join(to, entry.name)
      if (entry.isDirectory) {
        await Deno.mkdir(targetPath, { recursive: true })
        await walk(new URL(`${entry.name}/`, from), targetPath, `${prefix}${entry.name}/`)
        continue
      }
      const text = await Deno.readTextFile(new URL(entry.name, from))
      await Deno.writeTextFile(targetPath, text.replaceAll('__APP_NAME__', name))
      written.push(`${prefix}${entry.name}`)
    }
  }
  await walk(source, target, '')
  return written.sort()
}
