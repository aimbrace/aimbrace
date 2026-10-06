import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { UsageError } from '../src/args'
import {
  copyTemplate,
  initCommand,
  isValidName,
  nameFrom,
  parseInitOptions,
  TargetNotEmptyError,
  templateDir,
  templateFor,
  templatesRoot,
} from '../src/builtins/init'
import type { BuiltinContext } from '../src/builtins/shared'

const scratch = mkdtempSync(join(tmpdir(), 'aimbrace-init-test-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function session(cwd: string) {
  const out: string[] = []
  const err: string[] = []
  const ctx: BuiltinContext = {
    args: [],
    config: undefined,
    cwd,
    io: {
      stdout: { write: (text: string) => void out.push(text) },
      stderr: { write: (text: string) => void err.push(text) },
      cwd,
    },
    debug: false,
  }
  return { ctx, out: () => out.join(''), err: () => err.join('') }
}

async function init(args: readonly string[], cwd: string) {
  const s = session(cwd)
  const code = await initCommand({ ...s.ctx, args })
  return { code, out: s.out(), err: s.err() }
}

describe('init flags', () => {
  it('parses host, agent and name', () => {
    expect(
      parseInitOptions(['my-app', '--host', 'fastify', '--agent', '--name', 'x-y']),
    ).toMatchObject({
      directory: 'my-app',
      host: 'fastify',
      agent: true,
      name: 'x-y',
    })
    expect(parseInitOptions(['--no-agent']).agent).toBe(false)
    expect(parseInitOptions([]).agent).toBeUndefined()
  })

  it('rejects an unknown host, both agent flags and two directories', () => {
    expect(() => parseInitOptions(['--host', 'express'])).toThrow(UsageError)
    expect(() => parseInitOptions(['--agent', '--no-agent'])).toThrow(/not both/)
    expect(() => parseInitOptions(['a', 'b'])).toThrow(/at most one directory/)
    expect(() => parseInitOptions(['--bogus'])).toThrow(UsageError)
  })

  it('maps host and agent to a template', () => {
    expect(templateFor('hono', false)).toBe('hono')
    expect(templateFor('hono', true)).toBe('hono-agent')
    expect(templateFor('fastify', true)).toBe('fastify-agent')
  })
})

describe('init names', () => {
  it('validates and derives npm-safe names', () => {
    expect(isValidName('my-app2')).toBe(true)
    expect(isValidName('My App')).toBe(false)
    expect(isValidName('1app')).toBe(false)
    expect(nameFrom('/tmp/My Cool_App')).toBe('my-cool-app')
    expect(nameFrom('.')).toMatch(/^[a-z][a-z0-9-]*$/)
  })
})

describe('init copy', () => {
  it('refuses a non-empty target and writes nothing', () => {
    const target = join(scratch, 'occupied')
    mkdirSync(target)
    writeFileSync(join(target, 'keep.txt'), 'mine')
    expect(() => copyTemplate(join(templatesRoot(), 'hono'), target, 'x', 'Hono')).toThrow(
      TargetNotEmptyError,
    )
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('mine')
    expect(existsSync(join(target, 'package.json'))).toBe(false)
  })

  it('substitutes the name and host label, and keeps the package free of @aimbrace', () => {
    const target = join(scratch, 'fresh')
    copyTemplate(join(templatesRoot(), 'fastify-agent'), target, 'shop', 'Fastify')
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string>
    >
    expect(manifest.name).toBe('shop')
    const deps = { ...manifest.dependencies, ...manifest.devDependencies }
    expect(Object.keys(deps).filter((name) => name.startsWith('@aimbrace/'))).toEqual([])
    expect(readFileSync(join(target, 'README.md'), 'utf8')).toContain('Fastify')
  })

  it('finds all four templates', () => {
    for (const id of ['hono', 'hono-agent', 'fastify', 'fastify-agent'] as const) {
      expect(existsSync(templateDir(id))).toBe(true)
    }
  })
})

describe('init command', () => {
  it('scaffolds with defaults and says what next', async () => {
    const result = await init(['defaults', '--yes'], scratch)
    expect(result.code).toBe(0)
    expect(existsSync(join(scratch, 'defaults', 'src', 'app.mjs'))).toBe(true)
    expect(result.out).toContain('created defaults (hono)')
    expect(result.out).toContain('pnpm dev')
  })

  it('scaffolds the agent fastify variant from flags alone', async () => {
    const result = await init(['agent-shop', '--host', 'fastify', '--agent', '--yes'], scratch)
    expect(result.code).toBe(0)
    expect(
      readFileSync(join(scratch, 'agent-shop', 'src', 'plugins', 'agent.mjs'), 'utf8'),
    ).toContain("name: 'agent'")
    expect(result.out).toContain('fastify-agent')
  })

  it('refuses a non-empty directory with exit 1 and leaves it unchanged', async () => {
    const target = join(scratch, 'full')
    mkdirSync(target)
    writeFileSync(join(target, 'notes.md'), 'hello')
    const result = await init(['full', '--yes'], scratch)
    expect(result.code).toBe(1)
    expect(result.err).toContain('refusing to write')
    expect(readFileSync(join(target, 'notes.md'), 'utf8')).toBe('hello')
    expect(existsSync(join(target, 'package.json'))).toBe(false)
  })

  it('rejects an invalid name and writes nothing', async () => {
    await expect(init(['bad-name-dir', '--name', 'Not Valid', '--yes'], scratch)).rejects.toThrow(
      UsageError,
    )
    expect(existsSync(join(scratch, 'bad-name-dir'))).toBe(false)
  })
})
