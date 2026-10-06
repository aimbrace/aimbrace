import type { Owner, ServiceToken } from '@aimbrace/core'
import { type Effect, Layer, ManagedRuntime } from 'effect'
import {
  addService,
  type BindingLike,
  emptyContext,
  type IdentifierOf,
  toBinding,
} from './bindings'

/** Reads an AIMBRACE service. `ctx.get`, `scope.get` and `app.get` all fit. */
export type ServiceReader = (token: ServiceToken<any>) => any

/**
 * Build a `ManagedRuntime` whose context holds AIMBRACE services as Effect
 * services, so Effect programs can `yield*` them. Pass an `owner` (a plugin
 * context, a scope) and the runtime is disposed with it.
 *
 * @example
 * const runtime = createEffectRuntime(ctx.get, [Db, [Config, ConfigService]], ctx)
 * await runtime.runPromise(Effect.gen(function* () { return (yield* effectService(Db)).query() }))
 */
export function createEffectRuntime<const B extends readonly BindingLike[]>(
  read: ServiceReader,
  bindings: B,
  owner?: Owner,
): ManagedRuntime.ManagedRuntime<IdentifierOf<B[number]>, never> {
  let context = emptyContext()
  for (const like of bindings) {
    const [token, key] = toBinding(like)
    context = addService(context, key, read(token))
  }
  const runtime = ManagedRuntime.make(Layer.succeedContext(context))
  owner?.own(() => runtime.dispose())
  return runtime as ManagedRuntime.ManagedRuntime<IdentifierOf<B[number]>, never>
}

/**
 * Run an Effect inside an AIMBRACE lifetime: when the scope's (or app's, or
 * plugin's) signal aborts, the Effect fiber is interrupted and its
 * finalizers run, using Effect's own cancellation.
 */
export function runEffect<A, E, R>(
  lifetime: { readonly signal: AbortSignal },
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  effect: Effect.Effect<A, E, R>,
): Promise<A> {
  return runtime.runPromise(effect, { signal: lifetime.signal })
}
