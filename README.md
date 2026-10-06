# AIMBRACE

**A TypeScript application composition runtime built on [Cordis](https://github.com/cordiverse/cordis).**

Not another plugin framework: an app is a typed graph of plugins. Each plugin declares what it
`requires`, `provides` and hooks into; AIMBRACE derives the dependency graph, installs plugins in
topological order inside encapsulated contexts, runs a deterministic lifecycle and tears everything
down in reverse. Write a plugin once; run it under any host.

```ts
import { createApp, definePlugin, service } from '@aimbrace/core'

const Greeter = service<{ greet(name: string): string }>('greeter')

const greeter = definePlugin({
  id: 'greeter',
  provides: [Greeter],
  setup(ctx) {
    ctx.provide(Greeter, { greet: (name) => `Hello, ${name}!` })
  },
})

const app = createApp({ plugins: [greeter] })
await app.start()
console.log(app.get(Greeter).greet('world'))
await app.stop()
```

> Status: under active construction. See [`specs/000-roadmap`](./specs/000-roadmap/tasks.md) for the
> milestone ledger and [`docs/`](./docs) for documentation.

## Ideas it is built from

| Project | What AIMBRACE takes |
|---|---|
| Cordis | Context, services, fibers, isolation, effects |
| Effect | typed requirements, layers, scoped resources |
| Fastify | plugin graph, encapsulation, ordering |
| Hookable | typed hooks |
| Unplugin | one plugin contract, many hosts |
| Hono | minimal core, Web-standard requests |

## Development

```sh
corepack enable
pnpm install
pnpm run check   # lint, build, typecheck, test
```

The project is specified with [GitHub Spec Kit](https://github.com/github/spec-kit) under `specs/`.
The constitution is in `.specify/memory/constitution.md`.

## License

MIT
