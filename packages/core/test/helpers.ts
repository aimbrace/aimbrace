import type { StandardSchemaV1 } from '../src'

/** Poll until `check` returns a truthy value or the timeout passes. */
export async function waitFor<T>(check: () => T | undefined | false, timeout = 2000): Promise<T> {
  const deadline = Date.now() + timeout
  while (true) {
    const value = check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A tiny object schema with defaults, enough to exercise config validation without a library. */
export function objectSchema<T extends Record<string, 'string' | 'number'>>(
  shape: T,
  defaults: Partial<{ [K in keyof T]: T[K] extends 'number' ? number : string }> = {},
): StandardSchemaV1<
  Partial<{ [K in keyof T]: T[K] extends 'number' ? number : string }>,
  { [K in keyof T]: T[K] extends 'number' ? number : string }
> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate(value) {
        const input = (value ?? {}) as Record<string, unknown>
        const output: Record<string, unknown> = {}
        const issues: Array<{ message: string; path: string[] }> = []
        for (const [key, type] of Object.entries(shape)) {
          const raw = input[key] ?? (defaults as Record<string, unknown>)[key]
          if (raw === undefined) issues.push({ message: 'required', path: [key] })
          else if (typeof raw !== type) issues.push({ message: `expected ${type}`, path: [key] })
          else output[key] = raw
        }
        return issues.length > 0 ? { issues } : { value: output as never }
      },
    },
  }
}
