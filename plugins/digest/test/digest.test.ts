import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { digestFolder } from '../index.ts'

test('the digest changes with a file name or its bytes, and ignores node_modules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'digest-test-'))
  writeFileSync(join(dir, 'a.ts'), 'one')
  const first = digestFolder(dir)
  mkdirSync(join(dir, 'node_modules'))
  writeFileSync(join(dir, 'node_modules', 'x.js'), 'ignored')
  assert.equal(digestFolder(dir), first)
  writeFileSync(join(dir, 'a.ts'), 'two')
  assert.notEqual(digestFolder(dir), first)
  assert.equal(digestFolder(dir, 12).length, 12)
  rmSync(dir, { recursive: true, force: true })
})
