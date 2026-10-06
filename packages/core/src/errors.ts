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

/** One validation problem of a plugin config. */
export interface ConfigIssue {
  message: string
  /** Dotted path to the offending value; empty for the root. */
  path: string
}

/** A plugin config failed its schema. */
export class ConfigError extends AimbraceError {
  readonly subject: string
  readonly issues: readonly ConfigIssue[]

  constructor(subject: string, issues: readonly ConfigIssue[]) {
    super(
      'E_CONFIG',
      `Invalid config for ${subject}:\n${issues
        .map((issue) => `  - ${issue.message}${issue.path ? ` (at ${issue.path})` : ''}`)
        .join('\n')}`,
    )
    this.subject = subject
    this.issues = issues
  }
}

/** Two plugins in one graph share an id. */
export class DuplicatePluginError extends AimbraceError {
  readonly id: string

  constructor(id: string) {
    super('E_DUPLICATE_PLUGIN', `Plugin id "${id}" is registered more than once.`)
    this.id = id
  }
}

/** Two plugins provide the same service. */
export class DuplicateProviderError extends AimbraceError {
  readonly service: string
  readonly providers: readonly string[]

  constructor(service: string, providers: readonly string[]) {
    super(
      'E_DUPLICATE_PROVIDER',
      `Service "${service}" is provided by more than one plugin: ${providers.join(', ')}.`,
    )
    this.service = service
    this.providers = providers
  }
}

/** A required service has no provider. */
export class MissingDependencyError extends AimbraceError {
  readonly plugin: string
  readonly service: string
  readonly suggestions: readonly string[]

  constructor(plugin: string, service: string, suggestions: readonly string[] = []) {
    super(
      'E_MISSING_DEPENDENCY',
      `Plugin "${plugin}" requires service "${service}", but no plugin provides it.${
        suggestions.length > 0
          ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(' or ')}?`
          : ''
      }`,
    )
    this.plugin = plugin
    this.service = service
    this.suggestions = suggestions
  }
}

/** The required dependencies form a cycle. */
export class DependencyCycleError extends AimbraceError {
  /** The cycle as a path whose first and last entries are equal. */
  readonly cycle: readonly string[]

  constructor(cycle: readonly string[]) {
    super('E_DEPENDENCY_CYCLE', `Dependency cycle: ${cycle.join(' -> ')}.`)
    this.cycle = cycle
  }
}

/** A peer plugin is absent, or its version does not match. */
export class PeerError extends AimbraceError {
  readonly plugin: string
  readonly peer: string
  readonly range: string
  readonly found: string | undefined

  constructor(
    plugin: string,
    peer: string,
    range: string,
    found: string | undefined,
    invalid = false,
  ) {
    super(
      invalid ? 'E_INVALID_RANGE' : found === undefined ? 'E_MISSING_PEER' : 'E_PEER_VERSION',
      invalid
        ? `Plugin "${plugin}" declares an invalid version range "${range}" for peer "${peer}".`
        : found === undefined
          ? `Plugin "${plugin}" needs peer plugin "${peer}" (${range}), which is not registered.`
          : `Plugin "${plugin}" needs peer "${peer}" ${range}, but version ${found} is registered.`,
    )
    this.plugin = plugin
    this.peer = peer
    this.range = range
    this.found = found
  }
}

/** The graph has several problems at once. */
export class GraphValidationError extends AimbraceError {
  readonly errors: readonly AimbraceError[]

  constructor(errors: readonly AimbraceError[]) {
    super(
      'E_GRAPH_INVALID',
      `The plugin graph is invalid (${errors.length} problems):\n${errors
        .map((error) => `  - ${error.message}`)
        .join('\n')}`,
      { cause: errors[0] },
    )
    this.errors = errors
  }
}
