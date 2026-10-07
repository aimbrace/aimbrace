/**
 * The `aimbrace` command. Run it from a checkout:
 *
 *   deno run --allow-read --allow-write --allow-run=deno packages/cli/src/main.ts init ../my-app
 *
 * or install it once as `aimbrace` with `deno task install-cli` from the repository root.
 */
export { HELP, runCli, VERSION } from './cli.ts'
export { init, type InitOptions, parseInitOptions, UsageError } from './init.ts'
export type { Io } from './io.ts'
export {
  assertTargetFree,
  copyTemplate,
  isValidName,
  nameFrom,
  TargetNotEmptyError,
} from './project.ts'
export { type Template, templateDir, templateFor, TEMPLATES } from './templates.ts'

import { runCli } from './cli.ts'

if (import.meta.main) Deno.exit(await runCli(Deno.args))
