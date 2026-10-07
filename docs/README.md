# AIMBRACE documentation

AIMBRACE scaffolds apps built on [Cordis](https://www.npmjs.com/package/@deepseek-ai/cordis),
running on [Deno](https://deno.com). Cordis is the framework: plugins, services, dependencies,
lifecycle, cleanup and events. AIMBRACE adds no runtime of its own. `aimbrace init` copies a small,
working Cordis project in TypeScript that imports `@deepseek-ai/cordis` only, and you own every line
of it.

- [Getting started](getting-started.md) - `aimbrace init`, run the app, run its tests
- [Building with Cordis](cordis.md) - plugins, typed services, `inject`, effects, events, a scope
  per task, `Deno.serve`, permissions
