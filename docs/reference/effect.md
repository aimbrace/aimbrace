# @aimbrace/effect

Effect 4 interop. Peer dependency: `effect ^4.0.1`. Guide: [Effect interop](../guides/effect-interop.md).

| Export | |
|---|---|
| `layerPlugin({ id, version?, description?, requires?, provides, layer })` | Turn a `Layer` into a plugin. `requires` and `provides` are `[token, EffectService]` pairs; the layer's inputs and outputs must match them (compile time). The layer's scope is released when the plugin is disposed. |
| `createEffectRuntime(read, bindings, owner?)` | A `ManagedRuntime` whose context holds AIMBRACE services as Effect services. `read` is `ctx.get`, `scope.get` or `app.get`; bindings are bare tokens or `[token, EffectService]` pairs; the runtime is disposed with `owner`. |
| `runEffect(lifetime, runtime, effect)` | Run an Effect; it is interrupted (finalizers run) when `lifetime.signal` aborts. |
| `effectService(token)` | The Effect service for a token, created once per token (`aimbrace/<name>`). |
| `toBinding(like)` | Normalise a bare token or a pair into a `[token, key]` binding. |

Types: `Binding`, `BindingLike`, `IdentifierOf`, `TokensOf`, `LayerPluginOptions`, `ServiceReader`.

Limit: the Effect identifier of a token is `ServiceToken<T>`, so two tokens with the same value type are indistinguishable to the Effect type checker (their runtime keys differ).
