/**
 * Error types raised by the AIMBRACE runtime.
 *
 * Every error carries a stable `code` so tooling and tests can match on it
 * without parsing messages.
 */

/** Base class of all AIMBRACE errors. */
export class AimbraceError extends Error {
  /** Stable machine-readable identifier, for example `E_INVALID_NAME`. */
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

/** A service or registry token name does not match the allowed pattern. */
export class InvalidNameError extends AimbraceError {
  constructor(kind: string, name: unknown) {
    super(
      'E_INVALID_NAME',
      `Invalid ${kind} name ${JSON.stringify(name)}: expected letters, digits and "._:/-", starting with a letter.`,
    )
  }
}

/** Something was added to a lifetime that has already ended. */
export class DisposedError extends AimbraceError {
  constructor(what: string) {
    super('E_DISPOSED', `Cannot use ${what} after it was disposed.`)
  }
}

/** One or more disposers failed. Every disposer was still run. */
export class DisposalError extends AimbraceError {
  /** The failures, in the order they occurred. */
  readonly errors: readonly unknown[]

  constructor(errors: readonly unknown[]) {
    super(
      'E_DISPOSAL',
      `${errors.length} disposer${errors.length === 1 ? '' : 's'} failed: ${errors
        .map((error) => (error instanceof Error ? error.message : String(error)))
        .join('; ')}`,
      { cause: errors[0] },
    )
    this.errors = errors
  }
}

/** A registry entry with the same id already exists. */
export class DuplicateRegistryEntryError extends AimbraceError {
  constructor(registry: string, id: string) {
    super(
      'E_DUPLICATE_REGISTRY_ENTRY',
      `Registry "${registry}" already has an entry with id "${id}".`,
    )
  }
}
