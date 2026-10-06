import type { PluginContext } from './context'
import type { AppHooks } from './core-hooks'
import type { Disposer } from './disposable'
import { AimbraceError } from './errors'
import type { PluginMeta } from './graph'
import { assertName } from './internal/name'
import { parseVersion } from './semver'
import { isServiceToken, type ServiceToken } from './service'
import type { SchemaInput, SchemaOutput, StandardSchemaV1 } from './standard-schema'

/** A list of service tokens. Plugins declare `requires`, `optional` and `provides` as such lists. */
export type ServiceList = readonly ServiceToken<unknown>[]

/** A config schema, or none. */
export type ConfigSchema = StandardSchemaV1 | undefined

/** The validated config a plugin receives. */
export type ConfigOf<S extends ConfigSchema> = S extends StandardSchemaV1
  ? SchemaOutput<S>
  : undefined

/** The config a caller may pass. */
export type ConfigInputOf<S extends ConfigSchema> = S extends StandardSchemaV1
  ? SchemaInput<S>
  : undefined

/** What `setup` may return: nothing, or a cleanup function. */
// biome-ignore lint/suspicious/noConfusingVoidType: `void` lets a setup with no return statement or an expression body type-check
export type SetupResult = void | Disposer

/**
 * Everything a plugin declares.
 *
 * `requires`, `optional` and `provides` are inferred as exact tuples, which is
 * what limits `ctx.get`, `ctx.maybe` and `ctx.provide` inside `setup`.
 */
export interface PluginDefinition<
  R extends ServiceList = ServiceList,
  O extends ServiceList = ServiceList,
  P extends ServiceList = ServiceList,
  S extends ConfigSchema = ConfigSchema,
> {
  /** Unique id inside one app. Letters, digits and `._:/-`. */
  id: string
  /** Semantic version, used by `peers` checks of other plugins. */
  version?: string
  description?: string
  /** Services that must be provided by some plugin. */
  requires?: R
  /** Services used when present. */
  optional?: O
  /** Services this plugin makes available. `setup` must provide each of them. */
  provides?: P
  /** Other plugins that must be registered, with a version range each. */
  peers?: Readonly<Record<string, string>>
  /** Standard Schema for this plugin's config. */
  config?: S
  /** Hooks registered while the plugin is installed. */
  hooks?: Partial<AppHooks>
  /** Acquire resources and provide services. May return a cleanup function. */
  setup?(ctx: PluginContext<R, O, P>, config: ConfigOf<S>): SetupResult | Promise<SetupResult>
  /** Called after every plugin has been installed, in dependency order. */
  start?(ctx: PluginContext<R, O, P>, config: ConfigOf<S>): void | Promise<void>
  /** Called before disposal, in reverse dependency order. */
  stop?(ctx: PluginContext<R, O, P>, config: ConfigOf<S>): void | Promise<void>
}

/** The parts of a plugin the runtime needs, with the generics erased. */
export interface PluginRecord {
  readonly kind: 'plugin'
  readonly id: string
  readonly version: string | undefined
  readonly description: string | undefined
  /** Plain data view: what the graph, the CLI and build tools read. */
  readonly meta: PluginMeta
  /** The service tokens, in declaration order. */
  readonly tokens: {
    readonly requires: ServiceList
    readonly optional: ServiceList
    readonly provides: ServiceList
  }
  readonly definition: PluginDefinition
}

/**
 * A plugin. Call it with a config to get a configured instance:
 * `app.use(http({ port: 8080 }))`.
 */
export interface Plugin<
  R extends ServiceList = ServiceList,
  O extends ServiceList = ServiceList,
  P extends ServiceList = ServiceList,
  S extends ConfigSchema = ConfigSchema,
> extends PluginRecord {
  (config?: ConfigInputOf<S>): PluginInstance
  readonly definition: PluginDefinition<R, O, P, S>
}

/** A plugin together with the config it was configured with (not yet validated). */
export interface PluginInstance {
  readonly kind: 'plugin-instance'
  readonly plugin: PluginRecord
  readonly config: unknown
}

/** Anything `use` and `createApp` accept. */
export type PluginLike = PluginRecord | PluginInstance

/** Normalise a plugin or instance into the plugin and its raw config. */
export function resolvePluginLike(
  like: PluginLike,
  config?: unknown,
): { plugin: PluginRecord; config: unknown } {
  if (like.kind === 'plugin-instance') return { plugin: like.plugin, config: like.config }
  return { plugin: like, config }
}

function assertTokens(plugin: string, field: string, list: unknown): ServiceList {
  if (list === undefined) return []
  if (!Array.isArray(list)) {
    throw new AimbraceError(
      'E_INVALID_PLUGIN',
      `Plugin "${plugin}": "${field}" must be an array of service tokens.`,
    )
  }
  const seen = new Set<string>()
  for (const token of list) {
    if (!isServiceToken(token)) {
      throw new AimbraceError(
        'E_INVALID_PLUGIN',
        `Plugin "${plugin}": "${field}" contains a value that is not a service token. Create tokens with service().`,
      )
    }
    if (seen.has(token.name)) {
      throw new AimbraceError(
        'E_INVALID_PLUGIN',
        `Plugin "${plugin}": service "${token.name}" is listed twice in "${field}".`,
      )
    }
    seen.add(token.name)
  }
  return Object.freeze([...list]) as ServiceList
}

/**
 * Declare a plugin.
 *
 * @example
 * const Agent = definePlugin({
 *   id: 'agent',
 *   requires: [Model, Memory],
 *   provides: [AgentRuntime],
 *   setup(ctx) {
 *     ctx.provide(AgentRuntime, createRuntime(ctx.get(Model), ctx.get(Memory)))
 *   },
 * })
 */
export function definePlugin<
  const R extends ServiceList = readonly [],
  const O extends ServiceList = readonly [],
  const P extends ServiceList = readonly [],
  S extends ConfigSchema = undefined,
>(definition: PluginDefinition<R, O, P, S>): Plugin<R, O, P, S> {
  const { id } = definition
  assertName('plugin', id)
  if (definition.version !== undefined && !parseVersion(definition.version)) {
    throw new AimbraceError(
      'E_INVALID_PLUGIN',
      `Plugin "${id}": version "${definition.version}" is not a valid semantic version.`,
    )
  }
  const requires = assertTokens(id, 'requires', definition.requires)
  const optional = assertTokens(id, 'optional', definition.optional)
  const provides = assertTokens(id, 'provides', definition.provides)
  const required = new Set(requires.map((token) => token.name))
  for (const token of optional) {
    if (required.has(token.name)) {
      throw new AimbraceError(
        'E_INVALID_PLUGIN',
        `Plugin "${id}": service "${token.name}" is both required and optional.`,
      )
    }
  }

  const meta: PluginMeta = Object.freeze({
    id,
    version: definition.version,
    description: definition.description,
    requires: Object.freeze(requires.map((token) => token.name)),
    optional: Object.freeze(optional.map((token) => token.name)),
    provides: Object.freeze(provides.map((token) => token.name)),
    peers: definition.peers === undefined ? undefined : Object.freeze({ ...definition.peers }),
  })

  const configure = (config?: ConfigInputOf<S>): PluginInstance =>
    Object.freeze({ kind: 'plugin-instance' as const, plugin: plugin as PluginRecord, config })

  const plugin = Object.assign(configure, {
    kind: 'plugin' as const,
    id,
    version: definition.version,
    description: definition.description,
    meta,
    tokens: Object.freeze({ requires, optional, provides }),
    definition: Object.freeze({ ...definition }) as PluginDefinition<R, O, P, S>,
  })
  return Object.freeze(plugin) as unknown as Plugin<R, O, P, S>
}

/** True when `value` is a plugin. */
export function isPlugin(value: unknown): value is PluginRecord {
  return (
    (typeof value === 'function' || typeof value === 'object') &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'plugin'
  )
}

/** True when `value` is a configured plugin instance. */
export function isPluginInstance(value: unknown): value is PluginInstance {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'plugin-instance'
  )
}
