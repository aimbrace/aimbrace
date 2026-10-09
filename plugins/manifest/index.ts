/**
 * The app manifest (`aimbrace.yaml`): the app as data.
 *
 * Extracted from ACRYL Blends (`runtime/blends-core`): an app is an ordered list of plugin rows (`id`, `use`, `config`, `disabled`)
 * with typed parameters substituted into config as `{{parameters.name}}`, validated into structured diagnostics (a code and a path,
 * never a bare "invalid"), and locked with content digests so a reviewer can see exactly what an app is built from.
 *
 * The code an app can use stays in `src/app.ts` as a static registry of imports (so it type-checks); the manifest chooses, orders,
 * configures and switches those plugins. Extensions are not listed here: they come and go while the app runs.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import { parse } from 'yaml'

export const API_VERSION = 'aimbrace/v1'

export type ParameterType = 'string' | 'number' | 'boolean'
export type ParameterValue = string | number | boolean

export interface ParameterDeclaration {
  readonly type: ParameterType
  readonly default: ParameterValue
  readonly description?: string
}

/** One composition row: `id` is the slot, `use` the registry entry it mounts (defaults to the id). */
export interface Row {
  readonly id: string
  readonly use: string
  readonly config?: Readonly<Record<string, unknown>>
  readonly disabled?: boolean
}

export interface Manifest {
  readonly apiVersion: typeof API_VERSION
  readonly kind: 'App'
  readonly metadata: {
    readonly name: string
    readonly version: string
    readonly description?: string
  }
  readonly parameters: Readonly<Record<string, ParameterDeclaration>>
  readonly plugins: readonly Row[]
}

export type DiagnosticCode =
  | 'parse-error'
  | 'schema-error'
  | 'duplicate-row-id'
  | 'unknown-plugin'
  | 'dangling-parameter-reference'
  | 'unused-parameter'
  | 'parameter-type-mismatch'
  | 'parameter-override-unknown'

/** Every problem names where it is, as a path into the document. */
export interface Diagnostic {
  readonly code: DiagnosticCode
  readonly path: string
  readonly message: string
}

export class ManifestError extends Error {
  override name = 'ManifestError'
  readonly diagnostics: readonly Diagnostic[]
  constructor(source: string, diagnostics: readonly Diagnostic[]) {
    super(
      `${source} is not a valid app manifest:\n${diagnostics.map((d) => `  ${d.path}: ${d.message} [${d.code}]`).join('\n')}`,
    )
    this.diagnostics = diagnostics
  }
}

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const PARAMETER = /^[A-Za-z][A-Za-z0-9_-]*$/
const TOKEN = /\{\{parameters\.([A-Za-z0-9_-]+)\}\}/g
const WHOLE_TOKEN = /^\{\{parameters\.([A-Za-z0-9_-]+)\}\}$/
const TOP_FIELDS = new Set(['apiVersion', 'kind', 'metadata', 'parameters', 'plugins'])
const ROW_FIELDS = new Set(['id', 'use', 'config', 'disabled'])
const TYPES = new Set<ParameterType>(['string', 'number', 'boolean'])

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every string inside a config value, with its path. Tokens are recognised in string values only. */
function walkStrings(
  value: unknown,
  path: string,
  visit: (text: string, path: string) => void,
): void {
  if (typeof value === 'string') visit(value, path)
  else if (Array.isArray(value))
    for (const [index, item] of value.entries()) walkStrings(item, `${path}[${index}]`, visit)
  else if (isObject(value))
    for (const [key, item] of Object.entries(value)) walkStrings(item, `${path}.${key}`, visit)
}

/**
 * Validate a parsed document. An empty list means valid. `known` is the registry's names, so an unknown `use` is reported here, before
 * anything is mounted.
 */
export function validate(document: unknown, known?: Iterable<string>): Diagnostic[] {
  const problems: Diagnostic[] = []
  const add = (code: DiagnosticCode, path: string, message: string) =>
    problems.push({ code, path, message })
  if (!isObject(document))
    return [{ code: 'schema-error', path: '$', message: 'the manifest must be a map' }]
  for (const key of Object.keys(document))
    if (!TOP_FIELDS.has(key)) add('schema-error', key, `unknown field '${key}'`)
  if (document.apiVersion !== API_VERSION)
    add('schema-error', 'apiVersion', `must be '${API_VERSION}'`)
  if (document.kind !== 'App') add('schema-error', 'kind', "must be 'App'")
  const metadata = document.metadata
  if (!isObject(metadata))
    add('schema-error', 'metadata', 'missing required field metadata (name, version)')
  else {
    if (typeof metadata.name !== 'string' || !ID.test(metadata.name))
      add('schema-error', 'metadata.name', 'must be lowercase letters, digits and dashes')
    if (typeof metadata.version !== 'string' || metadata.version === '')
      add('schema-error', 'metadata.version', 'missing required field version')
  }

  const declared = new Map<string, ParameterType>()
  const parameters = document.parameters ?? {}
  if (!isObject(parameters))
    add('schema-error', 'parameters', 'must be a map of name to { type, default }')
  else {
    for (const [name, declaration] of Object.entries(parameters)) {
      const path = `parameters.${name}`
      if (!PARAMETER.test(name))
        add('schema-error', path, 'a parameter name is letters, digits, _ and -')
      if (!isObject(declaration) || !TYPES.has(declaration.type as ParameterType)) {
        add('schema-error', `${path}.type`, "must be 'string', 'number' or 'boolean'")
        continue
      }
      if (typeof declaration.default !== declaration.type)
        add('parameter-type-mismatch', `${path}.default`, `must be a ${declaration.type}`)
      declared.set(name, declaration.type as ParameterType)
    }
  }

  const used = new Set<string>()
  const registry = known ? new Set(known) : undefined
  const ids = new Set<string>()
  if (!Array.isArray(document.plugins))
    add('schema-error', 'plugins', 'must be a list of plugin rows')
  else {
    for (const [index, row] of (document.plugins as unknown[]).entries()) {
      const path = `plugins[${index}]`
      if (!isObject(row)) {
        add('schema-error', path, 'a row must be a map with at least an id')
        continue
      }
      for (const key of Object.keys(row))
        if (!ROW_FIELDS.has(key)) add('schema-error', `${path}.${key}`, `unknown field '${key}'`)
      if (typeof row.id !== 'string' || !ID.test(row.id)) {
        add('schema-error', `${path}.id`, 'must be lowercase letters, digits and dashes')
        continue
      }
      if (ids.has(row.id)) add('duplicate-row-id', `${path}.id`, `the id '${row.id}' is used twice`)
      ids.add(row.id)
      const use = row.use ?? row.id
      if (typeof use !== 'string') add('schema-error', `${path}.use`, 'must be a plugin name')
      else if (registry && !registry.has(use))
        add(
          'unknown-plugin',
          `${path}.use`,
          `no plugin '${use}' in the app's registry (known: ${[...registry].join(', ')})`,
        )
      if (row.disabled !== undefined && typeof row.disabled !== 'boolean')
        add('schema-error', `${path}.disabled`, 'must be true or false')
      if (row.config !== undefined && !isObject(row.config))
        add('schema-error', `${path}.config`, 'must be a map')
      if (isObject(row.config)) {
        walkStrings(row.config, `${path}.config`, (text, at) => {
          for (const [, name] of text.matchAll(TOKEN)) {
            used.add(name as string)
            if (!declared.has(name as string))
              add('dangling-parameter-reference', at, `refers to undeclared parameter '${name}'`)
          }
        })
      }
    }
  }
  for (const name of declared.keys())
    if (!used.has(name))
      add('unused-parameter', `parameters.${name}`, `'${name}' is declared but not used`)
  return problems
}

function substitute(value: unknown, values: Readonly<Record<string, ParameterValue>>): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE_TOKEN.exec(value)
    if (whole) return values[whole[1] as string] ?? value
    return value.replace(TOKEN, (token, name: string) =>
      name in values ? String(values[name]) : token,
    )
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, values))
  if (isObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, values)]),
    )
  return value
}

/** A manifest with its parameters resolved: every row's config has its tokens replaced, typed where a value is one whole token. */
export interface ResolvedManifest extends Manifest {
  readonly values: Readonly<Record<string, ParameterValue>>
  /** sha256 of the manifest file's bytes. */
  readonly digest: string
}

/**
 * Read, validate and resolve a manifest. `values` override parameter defaults (type-checked). Throws a `ManifestError` with every
 * diagnostic when the manifest is invalid.
 */
export function loadManifest(
  file: string,
  options: { known?: Iterable<string>; values?: Readonly<Record<string, ParameterValue>> } = {},
): ResolvedManifest {
  if (!existsSync(file))
    throw new ManifestError(file, [
      { code: 'parse-error', path: '$', message: 'the file does not exist' },
    ])
  const text = readFileSync(file, 'utf8')
  let document: unknown
  try {
    document = parse(text)
  } catch (error) {
    throw new ManifestError(file, [
      {
        code: 'parse-error',
        path: '$',
        message: error instanceof Error ? error.message : String(error),
      },
    ])
  }
  const diagnostics = validate(document, options.known)
  const raw = document as Omit<Manifest, 'plugins'> & {
    plugins: Array<Omit<Row, 'use'> & { use?: string }>
  }
  const values: Record<string, ParameterValue> = {}
  for (const [name, declaration] of Object.entries(raw.parameters ?? {}))
    values[name] = declaration.default
  for (const [name, value] of Object.entries(options.values ?? {})) {
    const declared = raw.parameters?.[name]
    if (!declared)
      diagnostics.push({
        code: 'parameter-override-unknown',
        path: `parameters.${name}`,
        message: `no parameter '${name}' to set`,
      })
    else if (typeof value !== declared.type)
      diagnostics.push({
        code: 'parameter-type-mismatch',
        path: `parameters.${name}`,
        message: `must be a ${declared.type}`,
      })
    else values[name] = value
  }
  if (diagnostics.length > 0) throw new ManifestError(file, diagnostics)
  const plugins: Row[] = raw.plugins.map((row) => ({
    id: row.id,
    use: row.use ?? row.id,
    ...(row.config === undefined
      ? {}
      : { config: substitute(row.config, values) as Record<string, unknown> }),
    ...(row.disabled === undefined ? {} : { disabled: row.disabled }),
  }))
  return {
    apiVersion: API_VERSION,
    kind: 'App',
    metadata: raw.metadata,
    parameters: raw.parameters ?? {},
    plugins,
    values,
    digest: createHash('sha256').update(text).digest('hex'),
  }
}

/** What an app can mount: a Cordis plugin per name. */
export type Registry = Readonly<Record<string, unknown>>

/**
 * Mount the manifest's enabled rows in order, each with its config merged under `overrides[id]` (runtime values such as the port win),
 * awaiting each one, because a fiber still waiting on an injected service reports done too early. Returns the fibers, in order.
 */
export async function compose(
  root: Context,
  manifest: Pick<Manifest, 'plugins'>,
  registry: Registry,
  overrides: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {},
): Promise<Fiber[]> {
  const fibers: Fiber[] = []
  for (const row of manifest.plugins) {
    if (row.disabled) continue
    const plugin = registry[row.use]
    if (!plugin)
      throw new ManifestError('the manifest', [
        { code: 'unknown-plugin', path: row.id, message: `no plugin '${row.use}' in the registry` },
      ])
    const config = { ...(row.config ?? {}), ...(overrides[row.id] ?? {}) }
    const fiber = root.plugin(plugin as Parameters<Context['plugin']>[0], config as never)
    fibers.push(fiber)
    await fiber.await()
  }
  return fibers
}

/** What `aimbrace lock` writes: the manifest's digest, its resolved rows, and a digest of each copied library plugin's source. */
export interface Lock {
  readonly manifest: { readonly name: string; readonly version: string; readonly digest: string }
  readonly values: Readonly<Record<string, ParameterValue>>
  readonly plugins: ReadonlyArray<{
    readonly id: string
    readonly use: string
    readonly disabled: boolean
  }>
  readonly sources: Readonly<Record<string, string>>
}

export function lock(manifest: ResolvedManifest, sources: Readonly<Record<string, string>>): Lock {
  return {
    manifest: {
      name: manifest.metadata.name,
      version: manifest.metadata.version,
      digest: `sha256:${manifest.digest}`,
    },
    values: manifest.values,
    plugins: manifest.plugins.map((row) => ({
      id: row.id,
      use: row.use,
      disabled: row.disabled === true,
    })),
    sources: Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))),
  }
}
