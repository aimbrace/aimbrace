/**
 * The Standard Schema interface (https://standardschema.dev), vendored so the
 * core needs no validation library. Zod, Valibot, ArkType and others implement
 * it, so any of them can describe a plugin's config.
 *
 * The interface is MIT licensed and designed to be copied.
 */
import { ConfigError } from './errors'

/** A schema that follows the Standard Schema specification. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaProps<Input, Output>
}

/** The `~standard` property of a schema. */
export interface StandardSchemaProps<Input = unknown, Output = Input> {
  readonly version: 1
  readonly vendor: string
  readonly validate: (
    value: unknown,
  ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>
  readonly types?: { readonly input: Input; readonly output: Output } | undefined
}

/** Outcome of validating a value. */
export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardSchemaIssue> }

/** One validation problem. */
export interface StandardSchemaIssue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
}

/** The input type a schema accepts. */
export type SchemaInput<S> = S extends StandardSchemaV1<infer I, unknown> ? I : undefined

/** The output type a schema produces. */
export type SchemaOutput<S> = S extends StandardSchemaV1<unknown, infer O> ? O : undefined

function formatPath(path: StandardSchemaIssue['path']): string {
  if (!path || path.length === 0) return ''
  return path
    .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.')
}

/**
 * Validate `value` with `schema`. Returns the parsed output or throws
 * {@link ConfigError} listing every issue with its path.
 */
export async function validateStandard<S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
  subject: string,
): Promise<SchemaOutput<S>> {
  const result = await schema['~standard'].validate(value)
  if (result.issues) {
    throw new ConfigError(
      subject,
      result.issues.map((issue) => ({ message: issue.message, path: formatPath(issue.path) })),
    )
  }
  return result.value as SchemaOutput<S>
}
