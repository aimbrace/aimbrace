import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseOptions, UsageError } from '../src/args'
import { copyTemplate, isValidName, nameFrom, TargetNotEmptyError } from '../src/copy'
import { run } from '../src/index'
import { templateFor, templatesRoot } from '../src/templates'

const scratch = mkdtempSync(join(tmpdir(), 'create-aimbrace-test-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function io(cwd: string, interactive = false) {
  const out: string[] = []
  const err: string[] = []
  return {
    io: {
      stdout: { write: (text: string) => void out.push(text) },
      stderr: { write: (text: string) => void err.push(text) },
      interactive,
      cwd,
    },
    out: () => out.join(''),
    err: () => err.join(''),
  }
}

describe('flags', () => {
  it('parses host, agent and name', () => {
    expect(parseOptions(['my-app', '--host', 'fastify', '--agent', '--name', 'x-y'])).toMatchObject({
      directory: 'my-app',
      host: 'fastify',
      agent: true,
      name: 'x-y',
    })
    expect(parseOptions(['--no-agent']).agent).toBe(false)
    expect(parseOptions([]).agent).toBeUndefined()
  })

  it('rejects an unknown host, both agent flags and two directories', () => {
    expect(() => parseOptions(['--host', 'express'])).toThrow(UsageError)
    expect(() => parseOptions(['--agent', '--no-agent'])).toThrow(/not both/)
    expect(() => parseOptions(['a', 'b'])).toThrow(/at most one directory/)
    expect(() => parseOptions(['--bogus'])).toThrow(UsageError)
  })

  it('maps host and agent to a template', () => {
    expect(templateFor('hono', false)).toBe('hono')
    expect(templateFor('hono', true)).toBe('hono-agent')
    expect(templateFor('fastify', true)).toBe('fastify-agent')
  })
})

describe('names', () => {
  it('validates and derives npm-safe names', () => {
    expect(isValidName('my-app2')).toBe(true)
    expect(isValidName('My App')).toBe(false)
    expect(isValidName('1app')).toBe(false)
    expect(nameFrom('/tmp/My Cool_App')).toBe('my-cool-app')
    expect(nameFrom('.')).toMatch(/^[a-z][a-z0-9-]*$/)
  })
})

describe('copy', () => {
  it('refuses a non-empty target and writes nothing', () => {
    const target = join(scratch, 'occupied')
    mkdirSync(target)
    writeFileSync(join(target, 'keep.txt'), 'mine')
    expect(() => copyTemplate(join(templatesRoot(), 'hono'), target, { name: 'x', hostLabel: 'Hono' })).toThrow(TargetNotEmptyError)
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('mine')
    expect(existsSync(join(target, 'package.json'))).toBe(false)
  })

  it('substitutes the name and host label, and keeps the package free of @aimbrace', () => {
    const target = join(scratch, 'fresh')
    copyTemplate(join(templatesRoot(), 'fastify-agent'), target, { name: 'shop', hostLabel: 'Fastify' })
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as Record<string, Record<string, string>>
    expect(manifest.name).toBe('shop')
    const deps = { ...manifest.dependencies, ...manifest.devDependencies }
    expect(Object.keys(deps).filter((name) => name.startsWith('@aimbrace/'))).toEqual([])
    expect(readFileSync(join(target, 'README.md'), 'utf8')).toContain('Fastify')
  })
})

describe('run', () => {
  it('scaffolds with defaults non-interactively (--yes) and says what next', async () => {
    const dir = join(scratch, 'defaults')
    const session = io(scratch)
    expect(await run(['defaults', '--yes'], session.io)).toBe(0)
    expect(existsSync(join(scratch, 'defaults', 'src', 'app.mjs'))).toBe(true)
    expect(session.out()).toContain('created defaults (hono)')
    expect(session.out()).toContain('pnpm dev')
    expect(dir).toContain('defaults')
  })

  it('scaffolds the agent fastify variant from flags alone', async () => {
    const session = io(scratch)
    expect(await run(['agent-shop', '--host', 'fastify', '--agent', '--yes'], session.io)).toBe(0)
    expect(readFileSync(join(scratch, 'agent-shop', 'src', 'plugins', 'agent.mjs'), 'utf8')).toContain("name: 'agent'")
    expect(session.out()).toContain('fastify-agent')
  })

  it('refuses a non-empty directory with exit 1 and leaves it unchanged', async () => {
    const target = join(scratch, 'full')
    mkdirSync(target)
    writeFileSync(join(target, 'notes.md'), 'hello')
    const session = io(scratch)
    expect(await run(['full', '--yes'], session.io)).toBe(1)
    expect(session.err()).toContain('refusing to write')
    expect(readFileSync(join(target, 'notes.md'), 'utf8')).toBe('hello')
    expect(existsSync(join(target, 'package.json'))).toBe(false)
  })

  it('rejects an invalid name with exit 2 and writes nothing', async () => {
    const session = io(scratch)
    expect(await run(['bad-name-dir', '--name', 'Not Valid', '--yes'], session.io)).toBe(2)
    expect(existsSync(join(scratch, 'bad-name-dir'))).toBe(false)
  })

  it('prints help and version without touching the disk', async () => {
    const session = io(scratch)
    expect(await run(['--help'], session.io)).toBe(0)
    expect(session.out()).toContain('create-aimbrace - scaffold a Cordis app')
    expect(await run(['--version'], session.io)).toBe(0)
  })

  it('uses the install hook when asked, and reports its failure', async () => {
    const session = io(scratch)
    const code = await run(['with-install', '--yes', '--install'], { ...session.io, install: async () => 1 })
    expect(code).toBe(1)
    expect(session.err()).toContain('pnpm install failed')
  })
})
