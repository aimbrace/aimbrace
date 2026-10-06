import { definePlugin, type Plugin, type ServiceToken } from '@aimbrace/core'
import { Layer, ManagedRuntime } from 'effect'
import {
  addService,
  type Binding,
  emptyContext,
  type IdentifierOf,
  readService,
  type TokensOf,
} from './bindings'

/** Options for {@link layerPlugin}. */
export interface LayerPluginOptions<
  RB extends readonly Binding[] = readonly [],
  PB extends readonly Binding[] = readonly [],
> {
  id: string
  version?: string
  description?: string
  /** AIMBRACE services the layer needs, each with the Effect service it is supplied as. */
  requires?: RB
  /** Effect services the layer builds, each with the AIMBRACE token it is exposed as. */
  provides: PB
  /** The layer. Its inputs must be the `requires` services, its outputs the `provides` services. */
  layer: Layer.Layer<IdentifierOf<PB[number]>, unknown, IdentifierOf<RB[number]>>
}

/**
 * Turn an Effect `Layer<ROut, E, RIn>` into an AIMBRACE plugin: `RIn` is the
 * plugin's `requires`, `ROut` its `provides`, and the layer's scope (its
 * finalizers) is released when the plugin is disposed.
 *
 * @example
 * const database = layerPlugin({
 *   id: 'database',
 *   requires: [[Config, ConfigService]],
 *   provides: [[Db, DbService]],
 *   layer: DbService.layer,
 * })
 */
export function layerPlugin<
  const RB extends readonly Binding[] = readonly [],
  const PB extends readonly Binding[] = readonly [],
>(options: LayerPluginOptions<RB, PB>): Plugin<TokensOf<RB>, readonly [], TokensOf<PB>, undefined> {
  const required = (options.requires ?? []) as readonly Binding[]
  const provided = options.provides as readonly Binding[]
  const plugin = definePlugin({
    id: options.id,
    ...(options.version === undefined ? {} : { version: options.version }),
    ...(options.description === undefined ? {} : { description: options.description }),
    requires: required.map(([token]) => token) as readonly ServiceToken<unknown>[],
    provides: provided.map(([token]) => token) as readonly ServiceToken<unknown>[],
    async setup(ctx) {
      const loose = ctx as unknown as {
        get(token: ServiceToken<any>): unknown
        provide(token: ServiceToken<any>, value: unknown): void
      }
      let inputs = emptyContext()
      for (const [token, key] of required) inputs = addService(inputs, key, loose.get(token))
      const layer = Layer.provide(
        options.layer as unknown as Layer.Layer<never, unknown, never>,
        Layer.succeedContext(inputs),
      )
      const runtime = ManagedRuntime.make(layer)
      // Release the layer's scope (its finalizers) with the plugin, newest resources first.
      ctx.own(() => runtime.dispose())
      const built = await runtime.context()
      for (const [token, key] of provided) loose.provide(token, readService(built, key))
    },
  })
  return plugin as unknown as Plugin<TokensOf<RB>, readonly [], TokensOf<PB>, undefined>
}
