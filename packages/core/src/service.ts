import { assertName } from './internal/name'

declare const valueType: unique symbol

/**
 * A typed handle for one service. The value type `T` exists only at compile
 * time; at runtime a token is a small frozen object identified by its name.
 */
export interface ServiceToken<T = unknown> {
  readonly kind: 'service'
  readonly name: string
  readonly description: string | undefined
  /** Phantom property that carries `T`. Never present at runtime. */
  readonly [valueType]?: T
}

/** Extract the value type of a service token. */
export type ValueOf<S> = S extends ServiceToken<infer T> ? T : never

/** Options for {@link service}. */
export interface ServiceOptions {
  /** Human readable description shown in graphs and docs. */
  description?: string
}

/**
 * Create a typed service token.
 *
 * @example
 * const Database = service<Database>('database')
 * ctx.provide(Database, connection)
 * const db = ctx.get(Database)
 */
export function service<T>(name: string, options: ServiceOptions = {}): ServiceToken<T> {
  assertName('service', name)
  return Object.freeze({ kind: 'service' as const, name, description: options.description })
}

/** True when `value` is a service token. */
export function isServiceToken(value: unknown): value is ServiceToken {
  return (
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'service'
  )
}
