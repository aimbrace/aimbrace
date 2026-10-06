# The CLI

`@aimbrace/cli` installs the `aimbrace` command. It is also **a host**: any plugin can contribute commands to a `Commands`
registry, and `aimbrace <name>` runs them inside a scope of the started app.

```text
aimbrace [options] <command> [args]

  graph [--format text|mermaid|dot|json]   print the plugin dependency graph (exit 1 if invalid)
  check                                    validate the graph and every plugin config (runs no setup)
  run [--once] [--inspect]                 start the app; stop on SIGINT or SIGTERM
  plugins                                  list installed plugin packages
  commands                                 list commands contributed by your plugins
  init [dir]                               scaffold a config and a first plugin
  <name> [args]                            run a command contributed by a plugin

  -c, --config <file>   config module or aimbrace.json (default: search upwards from the directory)
      --cwd <dir>       work in another directory
      --debug           print stack traces
  -h, --help            show help        -v, --version   show the version
```

Exit codes: `0` success, `1` failure, `2` usage error (unknown option, bad value, unknown command).

## What each command does

- **`graph`** loads the config and prints the [dependency graph](../concepts/dependency-graph.md) without starting anything. An
  invalid graph is printed, its problems go to stderr, and the exit code is 1. `--format mermaid` pastes straight into docs.
- **`check`** calls `app.validate()`: graph problems and config problems, nothing installed, no `setup` run. Use it in CI.
- **`run`** starts the app, lists the plugins with their states, waits for a signal, stops in reverse order. `--once` starts and stops
  immediately (a smoke test); `--inspect` prints the observed tree as JSON. A failed start prints the error chain and exits 1.
- **`plugins`** lists packages in `node_modules` that declare `"aimbrace": { "plugin": "..." }`.
- **`init`** writes `aimbrace.config.mjs`, `plugins/hello.mjs` and, if absent, `package.json`. It refuses to overwrite.

## Contribute a command

```ts docs-test
import assert from 'node:assert/strict'
import { createApp, service } from '@aimbrace/core'
import { Commands, commandsPlugin, RESERVED_COMMANDS } from '@aimbrace/cli'

const Greeter = service<{ greet(name: string, loud: boolean): string }>('greeter')

export const greetCommand = commandsPlugin('greet-commands', [
  {
    name: 'greet',
    description: 'Greet someone',
    usage: 'greet <name> [--loud]',
    options: { loud: { type: 'boolean', short: 'l' } },
    run(ctx) {
      const [name] = ctx.args
      if (!name) {
        ctx.stderr.write('greet needs a name\n')
        return 2 // the exit code
      }
      // ctx.scope is a scope of the started app: read any service
      ctx.stdout.write(`${ctx.scope.get(Greeter).greet(name, ctx.values.loud === true)}\n`)
    },
  },
])

// The plugin only adds to a registry; it works wherever the Commands registry is served.
const app = createApp({ plugins: [greetCommand] })
await app.start()
assert.deepEqual(app.registry(Commands).all().map((c) => c.name), ['greet'])
await app.stop()

// Built-in names are reserved.
for (const name of RESERVED_COMMANDS) assert.throws(() => commandsPlugin('x', [{ name, run: () => {} }]), /built-in command/)
```

`aimbrace greet ada --loud` loads the config, starts the app, opens `command:greet`, runs the command, disposes the scope and stops
the app, whatever the command does. The command's return value (a number) is the exit code.

A `CommandContext` has `name`, `args` (positionals), `values` (parsed `options`), `scope`, `stdout`, `stderr` and `cwd`. Options use Node's
`util.parseArgs` shape (`type`, `short`, `multiple`, `default`); unknown options are a usage error.

## `runCli` for tests and tools

`runCli(argv, io?)` is the whole CLI as a function. It never calls `process.exit`: it writes through `io.stdout`/`io.stderr`,
takes `io.cwd` and `io.signal` (what `run` waits on), and returns the exit code.

```ts
import { runCli } from '@aimbrace/cli'

let out = ''
const code = await runCli(['graph', '--format', 'mermaid'], {
  stdout: { write: (text) => void (out += text) },
  stderr: process.stderr,
  cwd: '/path/to/project',
})
```

The thin `bin/aimbrace.js` is `process.exitCode = await runCli(process.argv.slice(2))`.

## See it

`examples/agent-cli` contributes an `ask` command that runs an agent: `aimbrace ask "calc: 2 + 3 * 4" --trace`.
