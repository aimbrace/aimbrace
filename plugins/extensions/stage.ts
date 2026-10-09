/**
 * Staging: every installed version of an extension is a complete copy under `<home>/extensions-staged/<name>/<stamp>-<hash>/`.
 *
 * Extracted from ACRYL (`acryl-extension-context/lib/stage.js`). Node caches an ES module by URL, so a re-imported file keeps its old
 * code; a copy at a new path has fresh URLs for the entry and everything it imports, so it is evaluated anew. The author's source folder
 * is never modified. The hash makes an unchanged source recognisable; the stamp makes "newest" well defined.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'

const SKIP = new Set(['node_modules', '.git'])

function walk(dir: string, visit: (path: string, relative: string) => void, prefix = ''): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, visit, `${prefix}${entry.name}/`)
    else visit(path, `${prefix}${entry.name}`)
  }
}

/** A content hash of a folder's files (names and bytes), so an unchanged source keeps its version. */
export function hashFolder(dir: string, length = 12): string {
  const files: Array<[string, string]> = []
  walk(dir, (path, relative) => files.push([relative, path]))
  files.sort(([a], [b]) => (a < b ? -1 : 1))
  const hash = createHash('sha256')
  for (const [relative, path] of files)
    hash.update(relative).update('\0').update(readFileSync(path)).update('\0')
  return hash.digest('hex').slice(0, length)
}

/** Copy `source` into a new version folder under `stageRoot/<name>/` and return its path and version. */
export function stage(
  source: string,
  stageRoot: string,
  name: string,
): { dir: string; version: string } {
  const version = hashFolder(source)
  const stamp = String(Date.now()).padStart(15, '0')
  const dir = join(stageRoot, name, `${stamp}-${version}`)
  mkdirSync(dir, { recursive: true })
  cpSync(source, dir, { recursive: true, filter: (path) => !SKIP.has(basename(path)) })
  return { dir, version }
}

/** Delete staged versions of `name` except the ones to keep (best effort). Modules already loaded stay in memory until the app restarts. */
export function prune(stageRoot: string, name: string, keep: readonly string[]): void {
  const folder = join(stageRoot, name)
  if (!existsSync(folder)) return
  if (keep.length === 0) {
    rmSync(folder, { recursive: true, force: true })
    return
  }
  for (const entry of readdirSync(folder)) {
    const path = join(folder, entry)
    if (!keep.includes(path)) rmSync(path, { recursive: true, force: true })
  }
}
