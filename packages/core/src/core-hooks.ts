import type { Graph } from './graph'
import type { RegistryEvent } from './registry'

/** Lifecycle state of one plugin inside a running app. */
export type PluginState =
  | 'pending'
  | 'installing'
  | 'installed'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'disposed'

/** A plugin as hooks see it. */
export interface PluginInfo {
  readonly id: string
  readonly version: string | undefined
  readonly state: PluginState
}

/** A scope as hooks see it. */
export interface ScopeInfo {
  readonly id: string
  readonly name: string
  readonly parent: string | undefined
}

type Hook<Args extends unknown[] = []> = (...args: Args) => void | Promise<void>

/**
 * Hooks the runtime itself fires. Plugins add their own by merging into
 * {@link HookExtensions}.
 */
export interface CoreHooks {
  /** The dependency graph was built and validated. */
  'graph:built': Hook<[graph: Graph]>
  'app:starting': Hook
  'app:ready': Hook
  'app:stopping': Hook
  'app:stopped': Hook
  /** Before a plugin's `setup` runs. */
  'plugin:install': Hook<[plugin: PluginInfo]>
  /** After a plugin's `setup` finished and its services exist. */
  'plugin:installed': Hook<[plugin: PluginInfo]>
  'plugin:start': Hook<[plugin: PluginInfo]>
  'plugin:started': Hook<[plugin: PluginInfo]>
  'plugin:stop': Hook<[plugin: PluginInfo]>
  'plugin:stopped': Hook<[plugin: PluginInfo]>
  'plugin:dispose': Hook<[plugin: PluginInfo]>
  'plugin:error': Hook<[plugin: PluginInfo, error: unknown]>
  'service:provide': Hook<[service: string, plugin: string]>
  'service:remove': Hook<[service: string, plugin: string]>
  'registry:change': Hook<[event: RegistryEvent]>
  'scope:open': Hook<[scope: ScopeInfo]>
  'scope:close': Hook<[scope: ScopeInfo]>
}

/**
 * Merge point for hooks declared by plugins and packages.
 *
 * @example
 * declare module '@aimbrace/core' {
 *   interface HookExtensions {
 *     'agent:start': (run: { id: string }) => void
 *   }
 * }
 */
// biome-ignore lint/suspicious/noEmptyInterface: this is a declaration merging point
export interface HookExtensions {}

/** Every hook an app knows about. */
export type AppHooks = CoreHooks & HookExtensions
