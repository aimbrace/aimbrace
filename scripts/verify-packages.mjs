#!/usr/bin/env node
// Verify the built packages the way a consumer would see them:
// every main/types/exports target exists, and each package's entry point imports.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const failures = []

function targets(value, out = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith('./')) out.add(value)
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) targets(child, out)
  }
  return out
}

for (const group of ['packages', 'plugins']) {
  const base = join(root, group)
  if (!existsSync(base)) continue
  for (const name of readdirSync(base)) {
    const dir = join(base, name)
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.private) continue
    const files = new Set([
      ...targets(manifest.main),
      ...targets(manifest.types),
      ...targets(manifest.exports),
    ])
    for (const field of [manifest.main, manifest.types])
      if (typeof field === 'string') files.add(field.startsWith('./') ? field : `./${field}`)
    files.delete('./package.json')
    for (const file of files) {
      if (!existsSync(join(dir, file)))
        failures.push(`${manifest.name}: ${file} does not exist (run the build first)`)
    }
    const entry = manifest.exports?.['.']?.default ?? manifest.main
    if (entry && existsSync(join(dir, entry))) {
      try {
        await import(pathToFileURL(join(dir, entry)).href)
      } catch (error) {
        failures.push(`${manifest.name}: importing ${entry} failed: ${error.message}`)
      }
    }
    console.log(`verified ${manifest.name} (${files.size} files)`)
  }
}

if (failures.length > 0) {
  console.error(
    `\n${failures.length} package problem(s):\n${failures.map((f) => `  - ${f}`).join('\n')}`,
  )
  process.exit(1)
}
