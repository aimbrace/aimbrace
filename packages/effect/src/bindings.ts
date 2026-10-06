import type { ServiceToken } from '@aimbrace/core'
import { Context } from 'effect'

/**
 * Pairs an AIMBRACE token with the Effect service that carries the same value.
 * `Context.Service` classes and `effectService(token)` keys both qualify.
 */
export type Binding<T = any, I = any> = readonly [token: ServiceToken<T>, key: Context.Key<I, T>]

/** A binding, or a bare token (which is bound to `effectService(token)`). */
export type BindingLike<T = any, I = any> = Binding<T, I> | ServiceToken<T>

/** The Effect identifier of a binding (what shows up in an Effect's `R`). */
export type IdentifierOf<B> = B extends readonly [unknown, Context.Key<infer I, any>]
  ? I
  : B extends ServiceToken<any>
    ? B
    : never

/** The tokens of a tuple of bindings, preserving order. */
export type TokensOf<B extends readonly Binding[]> = {
  [K in keyof B]: B[K] extends readonly [infer T extends ServiceToken<any>, unknown] ? T : never
}

const keys = new WeakMap<ServiceToken<any>, Context.Key<any, any>>()

/**
 * The Effect service for an AIMBRACE token, created once per token. Inside an
 * Effect program: `const db = yield* effectService(Db)`.
 *
 * The identifier type is the token's own type, so two tokens with the same
 * value type are indistinguishable to the Effect type checker (their runtime
 * keys still differ).
 */
export function effectService<T>(token: ServiceToken<T>): Context.Service<ServiceToken<T>, T> {
  let key = keys.get(token)
  if (!key) {
    key = Context.Service<ServiceToken<T>, T>(`aimbrace/${token.name}`)
    keys.set(token, key)
  }
  return key as Context.Service<ServiceToken<T>, T>
}

/** Normalise a binding or bare token to a `[token, key]` pair. */
export function toBinding(like: BindingLike): Binding {
  return Array.isArray(like)
    ? (like as Binding)
    : [like as ServiceToken, effectService(like as ServiceToken)]
}

/** An Effect context with its service set erased. Effect's `Context<in R>` is contravariant, which makes dynamic assembly need one cast; it lives here. */
export type ErasedContext = Context.Context<any>

/** An empty erased context. */
export function emptyContext(): ErasedContext {
  return Context.empty() as unknown as ErasedContext
}

/** Add `value` under `key` to an erased context. */
export function addService(
  context: ErasedContext,
  key: Context.Key<any, any>,
  value: unknown,
): ErasedContext {
  return Context.add(context, key, value)
}

/** Read `key` from an erased context. Throws when absent. */
export function readService(context: unknown, key: Context.Key<any, any>): unknown {
  return Context.get(context as ErasedContext, key)
}
