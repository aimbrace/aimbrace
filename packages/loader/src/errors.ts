import { AimbraceError } from '@aimbrace/core'

/** Something went wrong while reading a config file or resolving a plugin. */
export class LoaderError extends AimbraceError {
  /** The config file being processed, when known. */
  readonly file: string | undefined
  /** The plugin specifier being resolved, when relevant. */
  readonly specifier: string | undefined

  constructor(
    message: string,
    details: { file?: string | undefined; specifier?: string | undefined; cause?: unknown } = {},
  ) {
    super('E_LOADER', message, details.cause === undefined ? undefined : { cause: details.cause })
    this.file = details.file
    this.specifier = details.specifier
  }
}
