# AIMBRACE documentation

AIMBRACE is a TypeScript **application composition runtime** built on [Cordis](https://github.com/cordiverse/cordis).
An app is a typed graph of plugins: each plugin declares what it requires and provides, and the runtime
orders, isolates, starts, scopes and tears everything down for you.

New here? Read [Quickstart](getting-started/quickstart.md), then [Overview](concepts/overview.md).

## Getting started

- [Installation](getting-started/installation.md) - packages, requirements, what is published and what is not
- [Quickstart](getting-started/quickstart.md) - your first app in ten minutes

## Concepts

- [Overview](concepts/overview.md) - what AIMBRACE is, the layers, what the core refuses to know
- [Services and tokens](concepts/services-and-tokens.md) - typed handles, typed access
- [Plugins](concepts/plugins.md) - `definePlugin`, the plugin context, config
- [The dependency graph](concepts/dependency-graph.md) - validation, ordering, exporters
- [Lifecycle](concepts/lifecycle.md) - start, stop, rollback, reactivation
- [Scopes](concepts/scopes.md) - temporal composability for tasks and requests
- [Registries](concepts/registries.md) - many contributors, no coupling
- [Hooks](concepts/hooks.md) - typed, extensible, self-cleaning
- [Isolation and nesting](concepts/isolation-and-nesting.md) - encapsulated subtrees
- [Hosts](concepts/hosts.md) - one plugin contract, many hosts

## Guides

- [Write a plugin](guides/write-a-plugin.md)
- [Test plugins](guides/testing-plugins.md)
- [HTTP hosts (Hono and Fastify)](guides/http-hosts.md)
- [Effect interop](guides/effect-interop.md)
- [Build-time graph (Unplugin)](guides/build-time-graph.md)
- [The CLI](guides/cli.md)
- [Config and loader](guides/config-and-loader.md)
- [AI agents](guides/ai-agents.md)
- [Error catalogue](guides/errors.md)

## Reference

- [@aimbrace/core](reference/core.md)
- [@aimbrace/http](reference/http.md)
- [@aimbrace/hono](reference/hono.md)
- [@aimbrace/fastify](reference/fastify.md)
- [@aimbrace/effect](reference/effect.md)
- [@aimbrace/unplugin](reference/unplugin.md)
- [@aimbrace/loader](reference/loader.md)
- [@aimbrace/cli](reference/cli.md)
- [@aimbrace/testing](reference/testing.md)
- [Reference plugins](reference/plugins.md) - model, memory, tools, agent

## Architecture

- [Decisions](architecture/decisions.md) - the choices behind the design, with the evidence
- [Comparison](architecture/comparison.md) - what was taken from Cordis, Effect, Fastify, Hookable, Unplugin and Hono

## Project

- [Status](status.md) - what is implemented, what is deferred, honestly
- The original architecture brief: [aimbrace_spec.md](aimbrace_spec.md)

## How these docs stay true

Snippets marked `ts docs-test` are executed by the test suite. Every relative link and anchor is checked.
Every runtime export of every package must appear in its reference page. If a page here is wrong, a test fails.
