import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { discoverPlugins } from '../src'

const root = mkdtempSync(join(tmpdir(), 'aimbrace-discover-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function write(path: string, data: unknown) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(data))
}

describe('discoverPlugins', () => {
  it('finds dependencies that declare an aimbrace plugin entry', () => {
    write(join(root, 'package.json'), {
      name: 'app',
      dependencies: { 'plugin-a': '1.0.0', 'plain-lib': '1.0.0' },
      devDependencies: { '@scope/plugin-b': '2.0.0' },
    })
    write(join(root, 'node_modules/plugin-a/package.json'), {
      name: 'plugin-a',
      version: '1.0.0',
      description: 'A plugin',
      aimbrace: { plugin: './dist/index.js' },
    })
    write(join(root, 'node_modules/plain-lib/package.json'), {
      name: 'plain-lib',
      version: '1.0.0',
    })
    write(join(root, 'node_modules/@scope/plugin-b/package.json'), {
      name: '@scope/plugin-b',
      version: '2.0.0',
      aimbrace: { plugin: 'main.mjs' },
    })
    write(join(root, 'node_modules/@aimbrace/plugin-extra/package.json'), {
      name: '@aimbrace/plugin-extra',
      aimbrace: { plugin: './index.js' },
    })

    const found = discoverPlugins(join(root, 'sub', 'dir'))
    expect(found.map((plugin) => plugin.name)).toEqual([
      '@aimbrace/plugin-extra',
      '@scope/plugin-b',
      'plugin-a',
    ])
    const a = found.find((plugin) => plugin.name === 'plugin-a')
    expect(a).toMatchObject({ version: '1.0.0', description: 'A plugin' })
    expect(a?.entry).toBe(join(root, 'node_modules/plugin-a/dist/index.js'))
  })

  it('returns an empty list when there is no package.json', () => {
    const bare = mkdtempSync(join(tmpdir(), 'aimbrace-bare-'))
    try {
      expect(Array.isArray(discoverPlugins(bare))).toBe(true)
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })
})
