import { DisposalError, DisposedError } from './errors'

/** A cleanup function. May be asynchronous. */
export type Disposer = () => void | PromiseLike<void>

/**
 * Something with a lifetime. Resources acquired "inside" an owner are released
 * when the owner ends. Plugins, scopes and tests all implement this one idea.
 */
export interface Owner {
  /**
   * Register a disposer to run when the owner ends.
   * @returns a function that unregisters the disposer without running it.
   */
  own(disposer: Disposer): () => void
}

/**
 * A last-in first-out stack of disposers.
 *
 * Disposal runs every disposer even when some fail, then throws one
 * {@link DisposalError} that lists the failures. Disposal is idempotent.
 */
export class DisposerStack implements Owner, AsyncDisposable {
  #disposers: Disposer[] = []
  #disposed = false
  #disposing: Promise<void> | undefined

  /** Number of registered disposers. */
  get size(): number {
    return this.#disposers.length
  }

  /** True once disposal has started. */
  get disposed(): boolean {
    return this.#disposed
  }

  /** Register a disposer. Throws {@link DisposedError} when already disposed. */
  own(disposer: Disposer): () => void {
    if (this.#disposed) throw new DisposedError('a DisposerStack')
    this.#disposers.push(disposer)
    return () => {
      const index = this.#disposers.lastIndexOf(disposer)
      if (index !== -1) this.#disposers.splice(index, 1)
    }
  }

  /** Alias of {@link own}, matching the `DisposableStack` vocabulary. */
  push(disposer: Disposer): () => void {
    return this.own(disposer)
  }

  /** Run all disposers, newest first. Safe to call repeatedly. */
  dispose(): Promise<void> {
    this.#disposing ??= this.#run()
    return this.#disposing
  }

  async #run(): Promise<void> {
    this.#disposed = true
    const errors: unknown[] = []
    while (this.#disposers.length > 0) {
      const disposer = this.#disposers.pop() as Disposer
      try {
        await disposer()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) throw new DisposalError(errors)
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose()
  }
}
