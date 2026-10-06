// Copy the template folders into the package so the published tarball is self-contained.
import { cpSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const source = resolve(import.meta.dirname, '..', '..', '..', 'templates')
const target = resolve(import.meta.dirname, '..', 'templates')
rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
console.log(`copied templates to ${join('packages', 'create', 'templates')}`)
