import { definePlugin } from '@aimbrace/core'
import * as v from 'valibot'
import { Model, ModelProviders, NoModelProviderError } from './tokens'
import type { ModelService } from './types'

const Shape = v.object({
  /** Provider id to use by default. Without it, the first registered provider is used. */
  provider: v.optional(v.string()),
})
/** Accepts no config at all: `undefined` becomes the defaults. */
const Config = v.optional(Shape, v.getDefaults(Shape))

/**
 * Provides the `Model` service. It routes each call to a provider from the
 * `ModelProviders` registry at call time, so providers can come and go while
 * the app runs.
 */
export const model = definePlugin({
  id: 'model',
  version: '0.1.0',
  description: 'Routes completions to registered model providers',
  provides: [Model],
  config: Config,
  setup(ctx, config) {
    const providers = ctx.registry(ModelProviders)
    const service: ModelService = {
      providers: () => providers.all().map((provider) => provider.id),
      async complete(request, options = {}) {
        const wanted = options.provider ?? config.provider
        const provider = wanted ? providers.get(wanted) : providers.all()[0]
        if (!provider) throw new NoModelProviderError(wanted, service.providers())
        await ctx.hooks.callHook('model:request', {
          provider: provider.id,
          messages: request.messages.length,
          tools: request.tools?.length ?? 0,
        })
        // The call ends when the caller aborts or when this plugin is disposed.
        const signal = options.signal ? AbortSignal.any([options.signal, ctx.signal]) : ctx.signal
        const response = await provider.complete(request, { signal })
        await ctx.hooks.callHook('model:response', {
          provider: provider.id,
          usage: response.usage,
          finishReason: response.finishReason,
        })
        return response
      },
    }
    ctx.provide(Model, service)
  },
})

export default model
