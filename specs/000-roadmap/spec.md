# AIMBRACE roadmap

## Product

AIMBRACE scaffolds apps built on Cordis, running on Deno. Cordis is the framework; AIMBRACE adds no
runtime. The product is the `aimbrace` command and its templates. A generated project depends on
`cordis` only.

## Milestones

| Milestone                                                                           | State               | Spec                                               |
| ----------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------- |
| M0 to M10: composition runtime, then a Hono/Fastify scaffolder                      | superseded, removed | [archive](../archive/README.md)                    |
| M11: Cordis is the framework                                                        | done                | [011-cordis-only](../011-cordis-only/spec.md)      |
| M12: ACRYL's Cordis as the framework, Deno as the runtime, builder inside the agent | in progress         | [012](../012-cordis-framework-and-builder/spec.md) |

## Next candidates (not started; each needs its own spec and a real app that asks for it)

- A real model provider plugin as an opt-in addition to the agent template.
- Hot reload of a single plugin during `pnpm dev`.
