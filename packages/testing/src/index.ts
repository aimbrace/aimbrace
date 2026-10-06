import {
  AimbraceError,
  type App,
  type AppOptions,
  createApp,
  definePlugin,
  type LeakProbe,
  type Plugin,
  type ServiceToken,
} from '@aimbrace/core'

/** A resource outlived its app. Lists every counter that was not zero. */
export class LeakError extends AimbraceError {
  readonly probe: LeakProbe

  constructor(probe: LeakProbe) {
    const leaks = Object.entries(probe)
      .filter(([key, value]) => key !== 'clean' && typeof value === 'number' && value > 0)
      .map(([key, value]) => `${key}=${value}`)
    super('E_LEAK', `The app leaked resources after stop(): ${leaks.join(', ')}.`)
    this.probe = probe
  }
}

/** Throw a {@link LeakError} unless the app released everything. Call after `stop()`. */
export function assertClean(app: App): void {
  const probe = app.probe()
  if (!probe.clean) throw new LeakError(probe)
}

/** One recorded hook call. */
export interface HookRecord {
  name: string
  args: unknown[]
}

/** Records every hook call of an app. */
export interface HookRecorder {
  /** Calls in the order they happened. */
  readonly records: readonly HookRecord[]
  /** Just the hook names, in order. */
  names(): string[]
  /** Forget what was recorded so far. */
  clear(): void
  /** Stop recording. */
  stop(): void
}

/** Record every hook call (lifecycle and plugin hooks) from now on. */
export function recordHooks(app: App): HookRecorder {
  const records: HookRecord[] = []
  const stop = app.hooks.beforeEach((event) => {
    records.push({ name: event.name, args: [...event.args] })
  })
  return {
    records,
    names: () => records.map((record) => record.name),
    clear: () => {
      records.length = 0
    },
    stop,
  }
}

/**
 * A plugin that provides a fixed value for a service: a stub for the real
 * provider, or a spy when `value` records its calls.
 */
export function mockService<T>(
  token: ServiceToken<T>,
  value: T,
  id = `mock:${token.name}`,
): Plugin {
  return definePlugin({
    id,
    provides: [token],
    setup(ctx) {
      ctx.provide(token, value)
    },
  }) as unknown as Plugin
}

/** A started app that stops itself and checks for leaks when disposed with `await using`. */
export interface TestApp extends AsyncDisposable {
  readonly app: App
  /** Records every hook call from before the app started. */
  readonly hooks: HookRecorder
}

/** Options for {@link startTestApp} and {@link withApp}. */
export type TestAppOptions = AppOptions

/**
 * Create and start an app. Disposing it (`await using`) stops it and throws a
 * {@link LeakError} if anything remained.
 *
 * @example
 * await using t = await startTestApp({ plugins: [memory] })
 * expect(t.app.get(Memory).recall()).toEqual([])
 */
export async function startTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const app = createApp(options)
  const hooks = recordHooks(app)
  await app.start()
  return {
    app,
    hooks,
    async [Symbol.asyncDispose]() {
      await app.stop()
      hooks.stop()
      assertClean(app)
    },
  }
}

/**
 * Run `body` against a started app, then stop it and assert nothing leaked.
 * The app is stopped and checked even when `body` throws; a body error wins over a leak error.
 *
 * @example
 * await withApp({ plugins: [memory, agent] }, async (app) => {
 *   expect(app.get(Agent).run()).toBe('ok')
 * })
 */
export async function withApp<T>(
  options: TestAppOptions,
  body: (app: App) => T | Promise<T>,
): Promise<T> {
  const app = createApp(options)
  let result: T
  try {
    await app.start()
    result = await body(app)
  } catch (error) {
    await app.stop().catch(() => {})
    throw error
  }
  await app.stop()
  assertClean(app)
  return result
}

/** Poll until `check` returns a truthy value or the timeout passes. */
export async function waitFor<T>(
  check: () => T | undefined | false | null,
  timeout = 2000,
): Promise<T> {
  const deadline = Date.now() + timeout
  while (true) {
    const value = check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeout}ms`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** A promise you resolve or reject from outside. */
export interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(reason?: unknown): void
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
