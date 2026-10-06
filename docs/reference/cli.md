# @aimbrace/cli

The `aimbrace` command, and a `Commands` registry any plugin can contribute to. Depends on `@aimbrace/core` and `@aimbrace/loader`. Guide: [The CLI](../guides/cli.md).

| Export | |
|---|---|
| `runCli(argv, io?)` | the whole CLI as a function; never calls `process.exit`; returns 0, 1 or 2 |
| `Commands` | `registry<Command>('cli.commands')`, keyed by command name |
| `commandsPlugin(id, commands)` | a plugin that only contributes commands; validates names |
| `RESERVED_COMMANDS` | the built-in names plugins may not reuse |
| `VERSION` | the package version |

Types: `Command` (`name`, `description?`, `usage?`, `options?`, `run(ctx)`), `CommandContext` (`name`, `args`, `values`, `scope`, `stdout`, `stderr`, `cwd`), `OptionSpec`, `Io` (`stdout`, `stderr`, `cwd`,
`signal?`), `Writer`.

The binary is `bin/aimbrace.js` (`process.exitCode = await runCli(process.argv.slice(2))`).
