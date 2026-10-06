/**
 * The only module that imports Cordis. Everything the runtime needs from it is
 * exposed here as a few small functions, so a Cordis upgrade touches one file.
 *
 * Cordis 4 is a release candidate: `cordis` is pinned exactly in package.json.
 */
import { Context } from 'cordis'

/** A Cordis context (root, plugin or scope). Opaque outside this module. */
export type CordisContext = Context

/** A Cordis fiber: the unit of activation and disposal. */
export interface CordisFiber extends PromiseLike<unknown> {
  readonly state: number
  /** Wait until the fiber settles. Rejects with the fiber error. */
  await(): Promise<unknown>
  /** Dispose the fiber and everything it owns. */
  dispose(): Promise<void>
}

/** Cordis fiber states, mirrored here because `const enum` cannot cross a package boundary. */
export const FIBER_STATE = {
  PENDING: 0,
  LOADING: 1,
  ACTIVE: 2,
  FAILED: 3,
  DISPOSED: 4,
  UNLOADING: 5,
} as const

const PREFIX = 'aimbrace:'

/** The Cordis service name of an AIMBRACE service. Prefixed so it can never collide with Cordis builtins. */
export function serviceKey(name: string): string {
  return `${PREFIX}${name}`
}

/** Create a fresh Cordis root context. */
export function createRoot(): CordisContext {
  return new Context()
}

/** What to run as a fiber. */
export interface FiberSpec {
  /** Shown in Cordis diagnostics. */
  name: string
  /** Cordis service names that must be available before `apply` runs. */
  inject?: readonly string[]
  /** Runs when the fiber activates. May be asynchronous. Must not throw. */
  apply(ctx: CordisContext): unknown
}

/** Create a fiber under `parent`. */
export function spawn(parent: CordisContext, spec: FiberSpec): CordisFiber {
  const plugin = { name: spec.name, inject: [...(spec.inject ?? [])], apply: spec.apply }
  // Cordis types `plugin()` through global interface merging; a loose signature keeps that out of our API.
  return (parent as unknown as { plugin(plugin: unknown): CordisFiber }).plugin(plugin)
}

/** Create a fiber, wait for its first activation, and return its context. */
export async function spawnScope(
  parent: CordisContext,
  name: string,
): Promise<{ ctx: CordisContext; fiber: CordisFiber }> {
  let captured: CordisContext | undefined
  const fiber = spawn(parent, {
    name,
    apply(ctx) {
      captured = ctx
    },
  })
  await fiber.await()
  if (!captured) throw new Error(`Cordis did not activate scope fiber "${name}".`)
  return { ctx: captured, fiber }
}

/** A context in which the service `key` has its own private namespace. */
export function isolate(ctx: CordisContext, key: string): CordisContext {
  return ctx.isolate(key)
}

/**
 * Provide `value` under `key` for the lifetime of the fiber that owns `ctx`.
 * Returns a function that removes the service early. Removal is asynchronous
 * (Cordis waits for dependents to unload), so callers must await it before the
 * owning fiber is disposed.
 */
export function provide(
  ctx: CordisContext,
  key: string,
  value: unknown,
): () => void | PromiseLike<void> {
  return ctx.provide(key, value) as () => void | PromiseLike<void>
}

/** Read a service from the context's namespace. `undefined` when absent or its provider is not active. */
export function lookup(ctx: CordisContext, key: string): unknown {
  return ctx.get(key)
}

/** Register a disposer on the fiber that owns `ctx`. */
export function onDispose(ctx: CordisContext, label: string, disposer: () => unknown): void {
  ctx.effect(() => () => disposer() as void | Promise<void>, label)
}

/** Number of distinct plugin callbacks Cordis still tracks. Zero once everything is disposed. The leak probe. */
export function trackedCallbacks(root: CordisContext): number {
  return root.registry.size
}
