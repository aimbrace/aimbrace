import { AimbraceError, registry, service } from '@aimbrace/core'
import type { ModelProvider, ModelService, Usage } from './types'

/** Providers contributed by plugins. */
export const ModelProviders = registry<ModelProvider>('ai.model-providers', {
  description: 'Model providers',
  key: (provider) => provider.id,
})

/** The model service. */
export const Model = service<ModelService>('ai.model', {
  description: 'Routes completions to a registered provider',
})

/** No provider could serve the call. */
export class NoModelProviderError extends AimbraceError {
  constructor(wanted: string | undefined, available: readonly string[]) {
    super(
      'E_NO_MODEL_PROVIDER',
      wanted
        ? `No model provider "${wanted}" is registered (available: ${available.join(', ') || 'none'}).`
        : 'No model provider is registered. Add one, for example the mock provider.',
    )
  }
}

declare module '@aimbrace/core' {
  interface HookExtensions {
    'model:request': (info: {
      provider: string
      messages: number
      tools: number
    }) => void | Promise<void>
    'model:response': (info: {
      provider: string
      usage: Usage
      finishReason: string
    }) => void | Promise<void>
  }
}
