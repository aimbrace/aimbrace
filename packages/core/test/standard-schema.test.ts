import { describe, expect, it } from 'vitest'
import { ConfigError, type StandardSchemaV1, validateStandard } from '../src'

const port: StandardSchemaV1<{ port?: unknown }, { port: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(value) {
      const input = (value ?? {}) as { port?: unknown }
      if (input.port === undefined) return { value: { port: 3000 } }
      if (typeof input.port !== 'number') {
        return { issues: [{ message: 'expected a number', path: ['port'] }] }
      }
      return { value: { port: input.port } }
    },
  },
}

describe('validateStandard', () => {
  it('returns the parsed output, including defaults', async () => {
    expect(await validateStandard(port, undefined, 'http')).toEqual({ port: 3000 })
    expect(await validateStandard(port, { port: 8080 }, 'http')).toEqual({ port: 8080 })
  })

  it('throws ConfigError with dotted issue paths', async () => {
    const failure = await validateStandard(port, { port: 'x' }, 'plugin "http"').catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(ConfigError)
    const error = failure as ConfigError
    expect(error.code).toBe('E_CONFIG')
    expect(error.subject).toBe('plugin "http"')
    expect(error.issues).toEqual([{ message: 'expected a number', path: 'port' }])
    expect(error.message).toBe('Invalid config for plugin "http":\n  - expected a number (at port)')
  })

  it('supports asynchronous validators and path segment objects', async () => {
    const asyncSchema: StandardSchemaV1<unknown, string> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async () => ({
          issues: [{ message: 'nope', path: [{ key: 'a' }, 'b', 0] }],
        }),
      },
    }
    const error = (await validateStandard(asyncSchema, 1, 'x').catch(
      (e: unknown) => e,
    )) as ConfigError
    expect(error.issues[0]?.path).toBe('a.b.0')
  })

  it('reports root issues without a path', async () => {
    const root: StandardSchemaV1<unknown, string> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ issues: [{ message: 'bad' }] }),
      },
    }
    const error = (await validateStandard(root, 1, 'x').catch((e: unknown) => e)) as ConfigError
    expect(error.message).toBe('Invalid config for x:\n  - bad')
  })
})
