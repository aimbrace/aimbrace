import type { InstallOptions, PluginHandle } from './context'
import type { PluginInfo, PluginState } from './core-hooks'
import {
  type AimbraceError,
  ConfigError,
  DisposalError,
  DuplicatePluginError,
  DuplicateProvideError,
  DuplicateProviderError,
  InvalidServiceValueError,
  MissingDependencyError,
  PluginError,
  type PluginPhase,
  UndeclaredAccessError,
  UnfulfilledProvideError,
} from './errors'
import { peerProblem, suggestNames } from './graph'
import {
  type CordisContext,
  type CordisFiber,
  FIBER_STATE,
  isolate,
  onDispose,
  provide,
  serviceKey,
  spawn,
} from './internal/cordis'
import type { Installer, Kernel } from './internal/kernel'
import { bindMethods, Lifetime } from './lifetime'
import { type PluginLike, type PluginRecord, resolvePluginLike } from './plugin'
import type { ServiceToken } from './service'
import { validateStandard } from './standard-schema'

type Phase =
  | 'created'
  | 'installing'
  | 'installed'
  | 'starting'
  | 'started'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'disposed'

/**
 * The context of one activation of a plugin. A plugin is activated again when
 * a provider it depends on returns, so each activation has its own resources.
 */
export class PluginContextImpl extends Lifetime {
  readonly pluginId: string
  readonly runtime: PluginRuntime
  /** Services this activation provided so far. */
  readonly provided = new Set<string>()
  readonly #requires: ReadonlySet<string>
  readonly #optional: ReadonlySet<string>
  readonly #provides: ReadonlySet<string>

  constructor(runtime: PluginRuntime, cctx: CordisContext, parent: Lifetime) {
    super(runtime.kernel, `plugin:${runtime.record.id}`, cctx, parent)
    this.runtime = runtime
    this.pluginId = runtime.record.id
    this.#requires = new Set(runtime.record.meta.requires)
    this.#optional = new Set(runtime.record.meta.optional)
    this.#provides = new Set(runtime.record.meta.provides)
    bindMethods(this, ['get', 'maybe', 'provide'])
  }

  get<T>(token: ServiceToken<T>): T {
    if (!this.#requires.has(token.name)) {
      throw new UndeclaredAccessError(this.pluginId, token.name, 'get')
    }
    return this.kernel.service(token, this.cctx)
  }

  maybe<T>(token: ServiceToken<T>): T | undefined {
    if (!this.#optional.has(token.name)) {
      throw new UndeclaredAccessError(this.pluginId, token.name, 'maybe')
    }
    return this.kernel.maybeService(token, this.cctx)
  }

  provide<T>(token: ServiceToken<T>, value: T): void {
    if (!this.#provides.has(token.name)) {
      throw new UndeclaredAccessError(this.pluginId, token.name, 'provide')
    }
    if (value === undefined || value === null) throw new InvalidServiceValueError(token.name)
    if (this.provided.has(token.name)) {
      throw new DuplicateProvideError(token.name, `plugin "${this.pluginId}"`)
    }
    const name = token.name
    const kernel = this.kernel
    let remove: (() => void | PromiseLike<void>) | undefined
    // Take ownership first: if this activation already ended, nothing is published.
    const disown = this.own(async () => {
      // Cordis removes a service asynchronously (it waits for dependents to unload); finish before the fiber goes.
      await remove?.()
      this.provided.delete(name)
      kernel.providers.delete(`${this.runtime.key}::${name}`)
      kernel.emit('service:remove', name, this.pluginId)
    })
    try {
      remove = provide(this.cctx, serviceKey(name), value)
    } catch (error) {
      disown()
      throw error
    }
    this.provided.add(name)
    kernel.providers.set(`${this.runtime.key}::${name}`, {
      service: name,
      provider: this.runtime.key,
    })
    kernel.emit('service:provide', name, this.pluginId)
  }
}

/** One plugin inside a running app: its fiber, its current activation and its lifecycle phase. */
export class PluginRuntime {
  readonly kernel: Kernel
  readonly record: PluginRecord
  readonly config: unknown
  readonly parent: PluginRuntime | undefined
  /** The lifetime that installed this plugin (app, plugin activation or scope). */
  readonly host: Lifetime
  /** Unique path: the id for a root plugin, `parent/id` for a nested one. */
  readonly key: string
  readonly children = new Set<PluginRuntime>()
  fiber: CordisFiber | undefined
  activation: PluginContextImpl | undefined
  phase: Phase = 'created'
  started = false
  error: PluginError | UnfulfilledProvideError | undefined
  /** Set when a Cordis unload stopped a started plugin, so a reactivation starts it again. */
  #restart = false
  /** How many times the fiber activated. The first failure is thrown to the installer; later ones are reported. */
  #activations = 0
  #disposing: Promise<void> | undefined

  constructor(
    kernel: Kernel,
    record: PluginRecord,
    config: unknown,
    host: Lifetime,
    parent: PluginRuntime | undefined,
  ) {
    this.kernel = kernel
    this.record = record
    this.config = config
    this.host = host
    this.parent = parent
    this.key = parent ? `${parent.key}/${record.id}` : record.id
  }

  get id(): string {
    return this.record.id
  }

  info(): PluginInfo {
    return { id: this.record.id, version: this.record.version, state: this.state() }
  }

  state(): PluginState {
    if (this.phase === 'disposed') return 'disposed'
    if (this.phase === 'failed') return 'failed'
    if (this.fiber?.state === FIBER_STATE.PENDING) return 'pending'
    switch (this.phase) {
      case 'installing':
        return 'installing'
      case 'installed':
        return 'installed'
      case 'starting':
        return 'starting'
      case 'started':
        return 'running'
      case 'stopping':
        return 'stopping'
      case 'stopped':
        return 'stopped'
      default:
        return 'pending'
    }
  }

  /** True when the plugin is installed, active and has not been started. */
  canStart(): boolean {
    return this.phase === 'installed' && !this.started && this.fiber?.state === FIBER_STATE.ACTIVE
  }

  /** Runs inside the Cordis fiber each time it activates. Never throws into Cordis. */
  async activate(cctx: CordisContext): Promise<void> {
    const ctx = new PluginContextImpl(this, cctx, this.host)
    this.activation = ctx
    this.#activations += 1
    onDispose(cctx, `aimbrace:${this.record.id}`, () => this.deactivate(ctx))
    let step: PluginPhase = 'install'
    try {
      this.phase = 'installing'
      await this.kernel.hooks.callHook('plugin:install', this.info())
      const hooks = this.record.definition.hooks
      if (hooks) {
        for (const [name, fn] of Object.entries(hooks)) {
          if (typeof fn === 'function') ctx.hooks.hook(name as never, fn as never)
        }
      }
      const result = await this.record.definition.setup?.(ctx as never, this.config as never)
      if (typeof result === 'function') ctx.own(result)
      const missing = this.record.meta.provides.filter((name) => !ctx.provided.has(name))
      if (missing.length > 0) throw new UnfulfilledProvideError(this.record.id, missing)
      this.phase = 'installed'
      await this.kernel.hooks.callHook('plugin:installed', this.info())
      if (this.#restart) {
        this.#restart = false
        step = 'start'
        await this.runStart(ctx)
      }
    } catch (cause) {
      this.error =
        cause instanceof UnfulfilledProvideError || cause instanceof PluginError
          ? cause
          : new PluginError(this.record.id, step, cause)
      this.phase = 'failed'
      this.kernel.emit('plugin:error', this.info(), this.error)
      if (this.#activations > 1)
        this.kernel.report(this.error, `plugin ${this.record.id} reactivation`)
      await ctx
        .end()
        .catch((failure: unknown) => this.kernel.report(failure, `plugin ${this.record.id}`))
    }
  }

  /** Runs when Cordis unloads or disposes the fiber. Stops a started plugin, then releases the activation. */
  async deactivate(ctx: PluginContextImpl): Promise<void> {
    if (this.started && this.activation === ctx) {
      this.#restart = true
      try {
        await this.runStop(ctx)
      } catch (error) {
        this.kernel.report(error, `plugin ${this.record.id} stop`)
      }
    }
    await ctx.end()
  }

  async runStart(ctx: PluginContextImpl): Promise<void> {
    this.phase = 'starting'
    await this.kernel.hooks.callHook('plugin:start', this.info())
    try {
      await this.record.definition.start?.(ctx as never, this.config as never)
    } catch (cause) {
      throw new PluginError(this.record.id, 'start', cause)
    }
    this.started = true
    this.phase = 'started'
    await this.kernel.hooks.callHook('plugin:started', this.info())
  }

  async runStop(ctx: PluginContextImpl): Promise<void> {
    this.phase = 'stopping'
    let failure: unknown
    try {
      await this.kernel.hooks.callHook('plugin:stop', this.info())
      try {
        await this.record.definition.stop?.(ctx as never, this.config as never)
      } catch (cause) {
        failure = new PluginError(this.record.id, 'stop', cause)
      }
    } finally {
      this.started = false
      this.phase = 'stopped'
    }
    await this.kernel.hooks.callHook('plugin:stopped', this.info())
    if (failure) {
      this.kernel.emit('plugin:error', this.info(), failure)
      throw failure
    }
  }

  /** Start this plugin (public wrapper used by the app). */
  async start(): Promise<void> {
    if (!this.activation) return
    await this.runStart(this.activation)
  }

  /** Stop this plugin if started (public wrapper used by the app). */
  async stop(): Promise<void> {
    if (!this.started || !this.activation) return
    await this.runStop(this.activation)
  }

  /** Stop, release and remove this plugin and the plugins nested in it. Idempotent. */
  dispose(): Promise<void> {
    this.#disposing ??= this.#dispose()
    return this.#disposing
  }

  async #dispose(): Promise<void> {
    const errors: unknown[] = []
    const attempt = async (fn: () => Promise<unknown> | unknown) => {
      try {
        await fn()
      } catch (error) {
        errors.push(error)
      }
    }
    const ctx = this.activation
    for (const child of [...this.children].reverse()) await attempt(() => child.dispose())
    if (this.started && ctx) await attempt(() => this.runStop(ctx))
    this.#restart = false
    if (ctx) await attempt(() => ctx.end())
    await attempt(() => this.fiber?.dispose())
    this.phase = 'disposed'
    this.kernel.runtimes.delete(this)
    const position = this.kernel.installOrder.indexOf(this)
    if (position !== -1) this.kernel.installOrder.splice(position, 1)
    this.parent?.children.delete(this)
    await attempt(() => this.kernel.hooks.callHook('plugin:dispose', this.info()))
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new DisposalError(errors)
  }
}

/** Validate a raw config with the plugin's schema, if it has one. */
export async function resolveConfig(plugin: PluginRecord, raw: unknown): Promise<unknown> {
  const schema = plugin.definition.config
  if (!schema) return raw
  try {
    return await validateStandard(schema, raw, `plugin "${plugin.id}"`)
  } catch (error) {
    if (error instanceof ConfigError) throw error
    throw new PluginError(plugin.id, 'config', error)
  }
}

interface SpawnOptions {
  isolate?: readonly ServiceToken<unknown>[] | undefined
  /** Start the plugin as soon as it is installed (the app is already running). */
  startNow: boolean
}

/** Create the runtime, spawn its fiber and wait for its first activation. */
export async function installRuntime(
  host: Lifetime,
  plugin: PluginRecord,
  config: unknown,
  options: SpawnOptions,
): Promise<PluginHandle> {
  const kernel = host.kernel
  const parent = host instanceof PluginContextImpl ? host.runtime : undefined
  const runtime = new PluginRuntime(kernel, plugin, config, host, parent)
  kernel.runtimes.add(runtime)
  kernel.installOrder.push(runtime)
  parent?.children.add(runtime)

  const isolated = options.isolate ?? []
  const base = baseContext(host, options)

  const fail = async (error: unknown): Promise<never> => {
    await runtime
      .dispose()
      .catch((failure: unknown) => kernel.report(failure, `plugin ${plugin.id}`))
    throw error
  }

  runtime.fiber = spawn(base, {
    name: `plugin:${plugin.id}`,
    inject: plugin.meta.requires.map(serviceKey),
    apply: (cctx) => runtime.activate(cctx),
  })
  try {
    await runtime.fiber.await()
  } catch (cause) {
    return fail(new PluginError(plugin.id, 'install', cause))
  }
  if (runtime.error) return fail(runtime.error)
  if (runtime.fiber.state !== FIBER_STATE.ACTIVE && isolated.length === 0) {
    return fail(
      new PluginError(plugin.id, 'install', new Error('its required services are not available')),
    )
  }
  if (options.startNow && runtime.canStart()) {
    try {
      await runtime.start()
    } catch (error) {
      return fail(error)
    }
  }

  // Root plugins are torn down by the app in reverse installation order; nested and
  // scoped ones also end with the lifetime that installed them.
  const forget = parent || host.parent ? host.own(() => runtime.dispose()) : undefined
  return {
    id: plugin.id,
    get state() {
      return runtime.state()
    },
    async dispose() {
      forget?.()
      await runtime.dispose()
    },
  }
}

/** The Cordis context a plugin installed with `options` would live in. */
function baseContext(
  host: Lifetime,
  options: { isolate?: readonly ServiceToken<unknown>[] | undefined } | undefined,
): CordisContext {
  let base = host.cctx
  for (const token of options?.isolate ?? []) base = isolate(base, serviceKey(token.name))
  return base
}

/** Checks for a plugin installed after the app started. Visibility is asked of Cordis, so isolation is respected. */
function dynamicProblems(
  host: Lifetime,
  plugin: PluginRecord,
  options: InstallOptions | undefined,
): AimbraceError[] {
  const kernel = host.kernel
  const meta = plugin.meta
  const errors: AimbraceError[] = []
  const hostRuntime = host instanceof PluginContextImpl ? host.runtime : undefined
  const siblings = [...kernel.runtimes].filter((runtime) => runtime.parent === hostRuntime)
  if (siblings.some((runtime) => runtime.id === meta.id))
    errors.push(new DuplicatePluginError(meta.id))

  const isolated = new Set((options?.isolate ?? []).map((token) => token.name))
  const base = baseContext(host, options)
  const known = [...new Set([...kernel.providers.values()].map((entry) => entry.service))]
  const providerOf = (service: string) =>
    [...kernel.providers.values()].find((entry) => entry.service === service)?.provider ??
    '(another plugin)'
  for (const service of meta.provides) {
    if (kernel.maybeService({ name: service } as ServiceToken<unknown>, base) !== undefined) {
      errors.push(new DuplicateProviderError(service, [providerOf(service), meta.id]))
    }
  }
  for (const service of meta.requires) {
    if (isolated.has(service)) continue
    if (kernel.maybeService({ name: service } as ServiceToken<unknown>, base) === undefined) {
      errors.push(new MissingDependencyError(meta.id, service, suggestNames(service, known)))
    }
  }
  for (const [peer, range] of Object.entries(meta.peers ?? {})) {
    const found = [...kernel.runtimes].find((runtime) => runtime.id === peer)?.record
    const problem = peerProblem(meta.id, peer, range, found)
    if (problem) errors.push(problem)
  }
  return errors
}

/** The installer the app injects into the kernel: validates, then installs at runtime. */
export const installer: Installer = {
  async install(
    host: Lifetime,
    like: PluginLike,
    rawConfig: unknown,
    options: InstallOptions | undefined,
  ) {
    const { plugin, config: raw } = resolvePluginLike(like, rawConfig)
    const problems = dynamicProblems(host, plugin, options)
    if (problems.length > 0) throw problems[0]
    const config = await resolveConfig(plugin, raw)
    return installRuntime(host, plugin, config, {
      isolate: options?.isolate,
      startNow: host.kernel.state === 'running',
    })
  },
}
