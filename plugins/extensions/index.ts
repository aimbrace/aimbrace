/**
 * The extensions service (`ctx.extensions`): install, update, remove and reload Cordis plugins while the app runs.
 *
 * Extracted from ACRYL (`plugins/acryl-extension-context/lib/install.js`, `stage.js`, `reconcile.js`), where an agent-written plugin
 * installs, runs, updates and is removed live in the packaged app on macOS, Windows and Linux. ACRYL goes through pnpm and the Harness
 * Loader; here an extension is a folder with an `index.ts` (or `.js`) that exports a Cordis plugin, mounted as a child fiber of this
 * plugin. The rules carried over:
 *
 * - Check before changing anything; every answer is a structured result the agent can act on (`ok`, `stage`, `errors`, `next`).
 * - Stage a content-hashed copy and import it fresh, so an update runs new code without a restart (`stage.ts`).
 * - Import the new version while the old one still runs; dispose the old one only then. If the new one fails to start, mount the old
 *   one again (`restoredPrevious`), so a broken update never leaves the app without the version that worked.
 * - Report the real fiber state: `active`, `pending` (with the services it waits for) or `failed` (with the real error).
 * - One operation at a time, in order. A ledger line for every change (`ledger.ts`).
 * - At startup, reinstall what was installed; install new folders only from sources trusted to `install`, and only list the rest
 *   (ACRYL's trust rule: code that arrived through a `git pull` must not run until someone asks for it).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { type Context, type Fiber, Service } from '@deepseek-ai/cordis'
import type {} from '../instance/index.ts'
import { appendLedger, type LedgerEntry, readLedger } from './ledger.ts'
import { resolveFromApp } from './resolve.ts'
import { hashFolder, prune, stage } from './stage.ts'

/** A fiber's lifecycle state, by name (Cordis's own enum is a `const enum`, which does not exist at run time). */
export type ExtensionState = 'pending' | 'loading' | 'active' | 'failed' | 'disposed' | 'unloading'
const STATES: readonly ExtensionState[] = [
  'pending',
  'loading',
  'active',
  'failed',
  'disposed',
  'unloading',
]

/** Whether new folders found in a source are installed at startup, or only listed until someone installs them. */
export type Trust = 'install' | 'list'

export interface ExtensionSource {
  readonly dir: string
  readonly trust: Trust
}

export interface ExtensionsConfig {
  /** Where extension folders may come from. Defaults to `<app home>/extensions`, trusted to install. */
  sources?: readonly ExtensionSource[]
}

export interface ExtensionInfo {
  readonly name: string
  readonly source: string
  readonly version: string
  readonly state: ExtensionState
  /** Services an extension waits for, when it is pending. */
  readonly missing: readonly string[]
  /** The source folder no longer exists; the last installed version still runs. */
  readonly stale: boolean
}

export type InstallResult =
  | {
      readonly ok: true
      readonly name: string
      readonly action: 'installed' | 'updated' | 'unchanged'
      readonly state: ExtensionState
      readonly missing: readonly string[]
      readonly version: string
    }
  | {
      readonly ok: false
      readonly stage: 'check' | 'import' | 'activate'
      readonly name?: string
      readonly errors: readonly string[]
      /** Present for an update: whether the version that was running is running again. */
      readonly restoredPrevious?: boolean
      readonly next: string
    }

export type RemoveResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly name: string; readonly errors: readonly string[] }

export interface StartupSummary {
  readonly installed: string[]
  readonly pending: string[]
  readonly stale: string[]
  readonly failed: Array<{ name: string; error: string }>
}

/** A Cordis plugin module as an extension exports it. */
interface PluginModule {
  readonly name?: unknown
  readonly inject?: unknown
  readonly apply: (...args: unknown[]) => unknown
}

interface Installed {
  readonly name: string
  readonly source: string
  readonly version: string
  /** The staged copy that is mounted. */
  readonly dir: string
  readonly module: PluginModule
  fiber: Fiber
}

interface Record_ {
  readonly source: string
  readonly version: string
  readonly dir: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    extensions: Extensions
  }

  interface Events {
    /** An extension was installed, updated, restored or removed. */
    'extensions/changed'(
      name: string,
      action: 'installed' | 'updated' | 'restored' | 'removed',
    ): void
  }
}

export const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const ENTRIES = ['index.ts', 'index.js', 'index.mjs']
const KEPT =
  'The version that was running is still running. Fix the error above, then install again.'
const RESTORED =
  'The version that was running is running again. Fix the error above, then install again.'
const NOTHING = 'Nothing was installed. Fix the error above, then install again.'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const inside = (path: string, folder: string) => {
  const rel = relative(resolve(folder), resolve(path))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function injected(module: PluginModule): string[] {
  const inject = module.inject
  if (Array.isArray(inject))
    return inject.filter((name): name is string => typeof name === 'string')
  if (inject && typeof inject === 'object') {
    const required = (inject as { required?: unknown }).required
    if (Array.isArray(required))
      return required.filter((name): name is string => typeof name === 'string')
    return Object.keys(inject)
  }
  return []
}

/** The service. One instance serves one app home. */
export class Extensions extends Service {
  readonly sources: readonly ExtensionSource[]
  readonly stageRoot: string
  readonly stateFile: string
  readonly ledgerFile: string
  /** Settles when the startup pass is done. */
  readonly ready: Promise<StartupSummary>
  private readonly installed = new Map<string, Installed>()
  private readonly stale = new Set<string>()
  private tail: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(ctx: Context, config: ExtensionsConfig = {}) {
    super(ctx, 'extensions')
    const { home, root } = ctx.appInstance
    this.sources = (config.sources ?? [{ dir: join(home, 'extensions'), trust: 'install' }]).map(
      (source) => ({
        dir: resolve(source.dir),
        trust: source.trust,
      }),
    )
    this.stageRoot = join(home, 'extensions-staged')
    this.stateFile = join(home, 'extensions.json')
    this.ledgerFile = join(home, 'extensions-ledger.jsonl')
    // Effects run their disposers newest first: settle pending operations, then dispose every mounted extension, then drop the hook.
    ctx.effect(
      () => resolveFromApp(this.stageRoot, root),
      'extensions: resolve staged imports from the app',
    )
    ctx.effect(
      () => async () => {
        for (const entry of [...this.installed.values()].reverse())
          await entry.fiber.dispose().catch(() => undefined)
        this.installed.clear()
      },
      'extensions: dispose mounted extensions',
    )
    ctx.effect(
      () => async () => {
        this.disposed = true
        await this.tail.catch(() => undefined)
      },
      'extensions: settle pending operations',
    )
    this.ready = this.serial(() => this.startup())
  }

  /** Install a folder, or update the installed extension of the same name. The folder must be inside one of the sources. */
  install(source: string): Promise<InstallResult> {
    return this.serial(() => this.installNow(source))
  }

  /** Remove an installed extension: dispose it, forget it, delete its staged copies. Its source folder is left alone. */
  remove(name: string): Promise<RemoveResult> {
    return this.serial(() => this.removeNow(name))
  }

  /** Bring every installed extension in line with its source, and install new folders from sources trusted to install. */
  reload(): Promise<InstallResult[]> {
    return this.serial(async () => {
      const results: InstallResult[] = []
      for (const entry of [...this.installed.values()]) {
        if (!existsSync(entry.source)) {
          this.stale.add(entry.name)
          continue
        }
        if (hashFolder(entry.source) !== entry.version)
          results.push(await this.installNow(entry.source))
      }
      for (const found of this.discover()) {
        if (found.trust === 'install' && !this.installed.has(found.name))
          results.push(await this.installNow(found.dir))
      }
      return results
    })
  }

  /** What is installed, with each extension's live state. */
  list(): ExtensionInfo[] {
    return [...this.installed.values()]
      .map((entry) => {
        const state = STATES[entry.fiber.state] ?? 'failed'
        return {
          name: entry.name,
          source: entry.source,
          version: entry.version,
          state,
          missing: state === 'pending' ? this.missing(entry.module) : [],
          stale: this.stale.has(entry.name),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Extension folders in the sources that are not installed. */
  pending(): Array<{ name: string; dir: string; trust: Trust }> {
    return this.discover().filter((found) => !this.installed.has(found.name))
  }

  /** Every change so far, oldest first. */
  ledger(): LedgerEntry[] {
    return readLedger(this.ledgerFile)
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const guarded = () => {
      if (this.disposed) return Promise.reject(new Error('extensions: the service is disposed'))
      return run()
    }
    const result = this.tail.then(guarded, guarded)
    this.tail = result.catch(() => undefined)
    return result
  }

  private discover(): Array<{ name: string; dir: string; trust: Trust }> {
    const found: Array<{ name: string; dir: string; trust: Trust }> = []
    for (const source of this.sources) {
      if (!existsSync(source.dir)) continue
      for (const entry of readdirSync(source.dir, { withFileTypes: true })) {
        const dir = join(source.dir, entry.name)
        if (
          entry.isDirectory() &&
          NAME.test(entry.name) &&
          ENTRIES.some((file) => existsSync(join(dir, file)))
        ) {
          if (!found.some((other) => other.name === entry.name))
            found.push({ name: entry.name, dir, trust: source.trust })
        }
      }
    }
    return found
  }

  /** The checks that need no code to run. */
  private check(source: string): { name: string; dir: string; errors: string[] } {
    const dir = resolve(source)
    const name = basename(dir)
    const errors: string[] = []
    if (!isAbsolute(source)) errors.push(`the path must be absolute, got "${source}"`)
    if (!this.sources.some((allowed) => inside(dir, allowed.dir))) {
      errors.push(
        `"${dir}" is not inside an extension source (${this.sources.map((allowed) => allowed.dir).join(', ')})`,
      )
    }
    if (!NAME.test(name))
      errors.push(
        `the folder name "${name}" must be lowercase letters, digits and dashes; it is the extension's name`,
      )
    if (!existsSync(dir) || !statSync(dir).isDirectory()) errors.push(`"${dir}" is not a folder`)
    else if (!ENTRIES.some((file) => existsSync(join(dir, file))))
      errors.push(`"${dir}" has no ${ENTRIES.join(', ')}`)
    return { name, dir, errors }
  }

  private async load(dir: string, name: string): Promise<PluginModule> {
    const entry = ENTRIES.map((file) => join(dir, file)).find((path) => existsSync(path)) as string
    const module = (await import(pathToFileURL(entry).href)) as Partial<PluginModule> & {
      default?: Partial<PluginModule>
    }
    const plugin = typeof module.apply === 'function' ? module : module.default
    if (!plugin || typeof plugin.apply !== 'function') {
      throw new Error(
        `${basename(entry)} must export a Cordis plugin: "export const name = '${name}'" and "export function apply(ctx) { ... }"`,
      )
    }
    if (plugin.name !== undefined && plugin.name !== name) {
      throw new Error(
        `the plugin is named "${String(plugin.name)}" but its folder is "${name}"; they must match`,
      )
    }
    return { ...plugin, name } as PluginModule
  }

  private missing(module: PluginModule): string[] {
    return injected(module).filter((service) => this.ctx.get(service) === undefined)
  }

  /** Mount a module as a child fiber and wait until it settles. */
  private async mount(module: PluginModule): Promise<{ fiber: Fiber; error?: unknown }> {
    // An extension is a plugin module whose config, if any, comes from its own defaults.
    const fiber = this.ctx.plugin(module as unknown as Parameters<Context['plugin']>[0])
    try {
      await fiber.await()
      return { fiber }
    } catch (error) {
      return { fiber, error }
    }
  }

  private record(entry: Omit<LedgerEntry, 'at'>): void {
    appendLedger(this.ledgerFile, entry)
  }

  private saveState(): void {
    const records: Record<string, Record_> = {}
    for (const entry of this.installed.values())
      records[entry.name] = { source: entry.source, version: entry.version, dir: entry.dir }
    mkdirSync(join(this.stateFile, '..'), { recursive: true })
    const temporary = `${this.stateFile}.${String(process.pid)}.tmp`
    writeFileSync(temporary, `${JSON.stringify(records, null, 2)}\n`)
    renameSync(temporary, this.stateFile)
  }

  private async installNow(source: string): Promise<InstallResult> {
    const { name, dir, errors } = this.check(source)
    if (errors.length > 0) return { ok: false, stage: 'check', name, errors, next: NOTHING }
    const previous = this.installed.get(name)
    const version = hashFolder(dir)
    if (previous && previous.version === version && STATES[previous.fiber.state] !== 'failed') {
      const state = STATES[previous.fiber.state] ?? 'failed'
      return {
        ok: true,
        name,
        action: 'unchanged',
        state,
        missing: state === 'pending' ? this.missing(previous.module) : [],
        version,
      }
    }

    // Import the new version while the old one keeps running: a syntax error or a missing export changes nothing.
    const staged = stage(dir, this.stageRoot, name)
    let module: PluginModule
    try {
      module = await this.load(staged.dir, name)
    } catch (error) {
      rmSync(staged.dir, { recursive: true, force: true })
      this.record({ kind: 'refused', name, version: staged.version, error: message(error) })
      return {
        ok: false,
        stage: 'import',
        name,
        errors: [message(error)],
        ...(previous ? { restoredPrevious: true } : {}),
        next: previous ? KEPT : NOTHING,
      }
    }

    if (previous) await previous.fiber.dispose()
    const mounted = await this.mount(module)
    const state = STATES[mounted.fiber.state] ?? 'failed'
    if (mounted.error !== undefined || state === 'failed') {
      await mounted.fiber.dispose().catch(() => undefined)
      rmSync(staged.dir, { recursive: true, force: true })
      const error = message(mounted.error ?? 'the plugin failed to start')
      this.record({ kind: 'refused', name, version: staged.version, error })
      let restored = false
      if (previous) {
        const again = await this.mount(previous.module)
        restored = again.error === undefined && STATES[again.fiber.state] !== 'failed'
        previous.fiber = again.fiber
        if (restored) {
          this.record({ kind: 'restored', name, version: previous.version })
          this.ctx.emit('extensions/changed', name, 'restored')
        } else {
          this.installed.delete(name)
          this.saveState()
        }
      }
      return {
        ok: false,
        stage: 'activate',
        name,
        errors: [error],
        ...(previous ? { restoredPrevious: restored } : {}),
        next: restored ? RESTORED : NOTHING,
      }
    }

    const action = previous ? 'updated' : 'installed'
    this.installed.set(name, {
      name,
      source: dir,
      version: staged.version,
      dir: staged.dir,
      module,
      fiber: mounted.fiber,
    })
    this.stale.delete(name)
    this.saveState()
    prune(this.stageRoot, name, [staged.dir])
    this.record({ kind: action, name, version: staged.version })
    this.ctx.emit('extensions/changed', name, action)
    return {
      ok: true,
      name,
      action,
      state,
      missing: state === 'pending' ? this.missing(module) : [],
      version: staged.version,
    }
  }

  private async removeNow(name: string): Promise<RemoveResult> {
    const entry = this.installed.get(name)
    if (!entry) return { ok: false, name, errors: [`"${name}" is not installed`] }
    await entry.fiber.dispose()
    this.installed.delete(name)
    this.stale.delete(name)
    this.saveState()
    prune(this.stageRoot, name, [])
    this.record({ kind: 'removed', name, version: entry.version })
    this.ctx.emit('extensions/changed', name, 'removed')
    return { ok: true, name }
  }

  /** Never throws: one extension's failure is recorded and the others still start. */
  private async startup(): Promise<StartupSummary> {
    const summary: StartupSummary = { installed: [], pending: [], stale: [], failed: [] }
    let records: Record<string, Record_> = {}
    try {
      if (existsSync(this.stateFile))
        records = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Record<string, Record_>
    } catch (error) {
      summary.failed.push({ name: 'extensions.json', error: message(error) })
    }
    for (const [name, record] of Object.entries(records)) {
      try {
        if (existsSync(record.source)) {
          const result = await this.installNow(record.source)
          if (result.ok) summary.installed.push(name)
          else summary.failed.push({ name, error: result.errors.join('; ') })
          continue
        }
        // The source is gone: the last installed version still runs, and is reported as stale.
        summary.stale.push(name)
        this.stale.add(name)
        if (!existsSync(record.dir)) {
          summary.failed.push({ name, error: 'neither the source nor the staged copy exists' })
          continue
        }
        const module = await this.load(record.dir, name)
        const mounted = await this.mount(module)
        if (mounted.error !== undefined)
          summary.failed.push({ name, error: message(mounted.error) })
        this.installed.set(name, {
          name,
          source: record.source,
          version: record.version,
          dir: record.dir,
          module,
          fiber: mounted.fiber,
        })
      } catch (error) {
        summary.failed.push({ name, error: message(error) })
      }
    }
    for (const found of this.discover()) {
      if (this.installed.has(found.name)) continue
      if (found.trust === 'list') {
        summary.pending.push(found.name)
        continue
      }
      try {
        const result = await this.installNow(found.dir)
        if (result.ok) summary.installed.push(found.name)
        else summary.failed.push({ name: found.name, error: result.errors.join('; ') })
      } catch (error) {
        summary.failed.push({ name: found.name, error: message(error) })
      }
    }
    if (Object.keys(records).length > 0 || summary.installed.length > 0) this.saveState()
    return summary
  }
}

/** The plugin: mount it after `instance`. Installed extensions mount as its children and leave with it. */
export const extensions = {
  name: 'extensions',
  inject: ['appInstance'],
  async apply(ctx: Context, config: ExtensionsConfig) {
    const service = new Extensions(ctx, config ?? {})
    await service.ready
  },
}
