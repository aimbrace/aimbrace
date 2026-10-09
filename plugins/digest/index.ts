/** A content digest of a folder: its files' relative names and bytes, in a stable order. The one definition both staging and the lock use. */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Folders that are never part of an app's own source. */
export const SKIPPED = new Set(['node_modules', '.git'])

function walk(dir: string, visit: (path: string, relative: string) => void, prefix = ''): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, visit, `${prefix}${entry.name}/`)
    else visit(path, `${prefix}${entry.name}`)
  }
}

/** The sha256 of a folder's content, as hex; `length` shortens it. Unchanged content keeps its digest on every machine. */
export function digestFolder(dir: string, length = 64): string {
  const files: Array<[string, string]> = []
  walk(dir, (path, relative) => files.push([relative, path]))
  files.sort(([a], [b]) => (a < b ? -1 : 1))
  const hash = createHash('sha256')
  for (const [relative, path] of files)
    hash.update(relative).update('\0').update(readFileSync(path)).update('\0')
  return hash.digest('hex').slice(0, length)
}
