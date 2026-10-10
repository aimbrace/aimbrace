/**
 * The app manifest (`blend.yaml`): the app as data, in ACRYL's own Blend format (`blends.acryl.dev/v1alpha1`).
 *
 * Extracted from ACRYL Blends (`runtime/blends-core`). A manifest this plugin accepts is a valid ACRYL `blend.yaml`: a test checks
 * the templates' manifests against ACRYL's JSON schema, so an app can move into ACRYL without conversion. What it reads today is a
 * `Blueprint` with ordered `spec.rows` (`id` is the slot, `name` the plugin it loads, optional `config` and `disabled`) and typed
 * `spec.parameters` substituted into config as `{{parameters.name}}`. Inheritance (`extends`, `lineage`, `overrides`) is part of the
 * format but not read yet, and is reported as `unsupported` instead of being ignored. Problems are diagnostics with a code and a
 * path, never a bare "invalid"; a lock records content digests so a reviewer sees what an app is built from.
 *
 * The code an app can use stays in `src/app.ts` as a static registry of imports (so it type-checks); the manifest chooses, orders,
 * configures and switches those plugins. Extensions are not listed here: they come and go while the app runs.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import { parse } from 'yaml'

export const API_VERSION = 'blends.acryl.dev/v1alpha1'
/** The file name ACRYL uses for an app definition. */
export const MANIFEST_FILE = 'blend.yaml'

export type ParameterType = 'string' | 'number' | 'boolean'
export type ParameterValue = string | number | boolean

export interface ParameterDeclaration {
  readonly type: ParameterType
  readonly default: ParameterValue
}

/** A row as written in `spec.rows`. */
export interface BlendRow {
  readonly id: string
  readonly name: string
  readonly config?: Readonly<Record<string, unknown>>
  readonly disabled?: boolean
}

/** A row as the app mounts it: `use` is the registry entry the row's `name` selects. */
export interface Row {
  readonly id: string
  readonly use: string
  readonly config?: Readonly<Record<string, unknown>>
  readonly disabled?: boolean
}

export interface Metadata {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly category?: string
  readonly description?: string
  readonly license?: string
  /** Anything but an explicit `public` is private: `save` never pushes a private app to a public remote. */
  readonly visibility?: 'private' | 'public'
}

export interface Manifest {
  readonly apiVersion: typeof API_VERSION
  readonly kind: 'Blueprint'
  readonly metadata: Metadata
  readonly spec: {
    readonly runtime: 'cordis'
    readonly parameters?: Readonly<Record<string, ParameterDeclaration>>
    readonly rows?: readonly BlendRow[]
  }
}

export type DiagnosticCode =
  | 'parse-error'
  | 'schema-error'
  | 'unsupported'
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

const DEFINITION_ID = /^[a-z0-9]+(\.[a-z0-9-]+)+$/
const ROW_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
const PARAMETER = /^[A-Za-z][A-Za-z0-9_-]*$/
const TOKEN = /\{\{parameters\.([A-Za-z0-9_-]+)\}\}/g
const WHOLE_TOKEN = /^\{\{parameters\.([A-Za-z0-9_-]+)\}\}$/
const TOP_FIELDS = new Set(['apiVersion', 'kind', 'metadata', 'spec'])
const METADATA_FIELDS = new Set([
  'id',
  'name',
  'version',
  'category',
  'description',
  'license',
  'visibility',
])
const SPEC_FIELDS = new Set(['runtime', 'parameters', 'rows'])
const INHERITANCE_FIELDS = new Set(['extends', 'lineage', 'overrides'])
const ROW_FIELDS = new Set(['id', 'name', 'config', 'disabled'])
const PARAMETER_FIELDS = new Set(['type', 'default'])
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
 * Validate a parsed document. An empty list means valid. `known` is the registry's names, so an unknown row `name` is reported here,
 * before anything is mounted.
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
  if (document.kind === 'Blend')
    add(
      'unsupported',
      'kind',
      'a Blend needs a lineage to its Blueprint, which is not read yet; use kind: Blueprint',
    )
  else if (document.kind !== 'Blueprint') add('schema-error', 'kind', "must be 'Blueprint'")

  const metadata = document.metadata
  if (!isObject(metadata))
    add('schema-error', 'metadata', 'missing required field metadata (id, name, version)')
  else {
    for (const key of Object.keys(metadata))
      if (!METADATA_FIELDS.has(key))
        add('schema-error', `metadata.${key}`, `unknown field '${key}'`)
    if (typeof metadata.id !== 'string' || !DEFINITION_ID.test(metadata.id))
      add('schema-error', 'metadata.id', "must be a dotted id such as 'aimbrace.my-app'")
    if (typeof metadata.name !== 'string' || metadata.name === '')
      add('schema-error', 'metadata.name', 'missing required field name')
    if (typeof metadata.version !== 'string' || !SEMVER.test(metadata.version))
      add('schema-error', 'metadata.version', 'must be a semantic version such as 0.1.0')
    if (
      metadata.visibility !== undefined &&
      metadata.visibility !== 'private' &&
      metadata.visibility !== 'public'
    )
      add('schema-error', 'metadata.visibility', "must be 'private' or 'public'")
  }

  const spec = document.spec
  const declared = new Map<string, ParameterType>()
  const used = new Set<string>()
  const registry = known ? new Set(known) : undefined
  const ids = new Set<string>()
  if (!isObject(spec)) {
    add('schema-error', 'spec', 'missing required field spec (runtime)')
    return problems
  }
  for (const key of Object.keys(spec)) {
    if (INHERITANCE_FIELDS.has(key))
      add('unsupported', `spec.${key}`, `'${key}' is part of the Blend format but is not read yet`)
    else if (!SPEC_FIELDS.has(key)) add('schema-error', `spec.${key}`, `unknown field '${key}'`)
  }
  if (spec.runtime !== 'cordis') add('schema-error', 'spec.runtime', "must be 'cordis'")

  const parameters = spec.parameters ?? {}
  if (!isObject(parameters))
    add('schema-error', 'spec.parameters', 'must be a map of name to { type, default }')
  else {
    for (const [name, declaration] of Object.entries(parameters)) {
      const path = `spec.parameters.${name}`
      if (!PARAMETER.test(name))
        add('schema-error', path, 'a parameter name is letters, digits, _ and -')
      if (!isObject(declaration) || !TYPES.has(declaration.type as ParameterType)) {
        add('schema-error', `${path}.type`, "must be 'string', 'number' or 'boolean'")
        continue
      }
      for (const key of Object.keys(declaration))
        if (!PARAMETER_FIELDS.has(key))
          add('schema-error', `${path}.${key}`, `unknown field '${key}'`)
      if (typeof declaration.default !== declaration.type)
        add('parameter-type-mismatch', `${path}.default`, `must be a ${declaration.type}`)
      declared.set(name, declaration.type as ParameterType)
    }
  }

  const rows = spec.rows ?? []
  if (!Array.isArray(rows)) add('schema-error', 'spec.rows', 'must be a list of rows')
  else {
    for (const [index, row] of (rows as unknown[]).entries()) {
      const path = `spec.rows[${index}]`
      if (!isObject(row)) {
        add('schema-error', path, 'a row must be a map with an id and a name')
        continue
      }
      for (const key of Object.keys(row))
        if (!ROW_FIELDS.has(key)) add('schema-error', `${path}.${key}`, `unknown field '${key}'`)
      if (typeof row.id !== 'string' || !ROW_ID.test(row.id)) {
        add('schema-error', `${path}.id`, 'must be lowercase letters, digits and dashes')
        continue
      }
      if (ids.has(row.id)) add('duplicate-row-id', `${path}.id`, `the id '${row.id}' is used twice`)
      ids.add(row.id)
      if (typeof row.name !== 'string' || row.name === '')
        add(
          'schema-error',
          `${path}.name`,
          'missing required field name (the plugin this row loads)',
        )
      else if (registry && !registry.has(row.name))
        add(
          'unknown-plugin',
          `${path}.name`,
          `no plugin '${row.name}' in the app's registry (known: ${[...registry].join(', ')})`,
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
      add('unused-parameter', `spec.parameters.${name}`, `'${name}' is declared but not used`)
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
  /** The rows to mount, in order: `use` is the registry entry each row's `name` selects. */
  readonly plugins: readonly Row[]
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
  const raw = document as Manifest
  const declarations = raw.spec?.parameters ?? {}
  const values: Record<string, ParameterValue> = {}
  for (const [name, declaration] of Object.entries(declarations)) values[name] = declaration.default
  for (const [name, value] of Object.entries(options.values ?? {})) {
    const declared = declarations[name]
    if (!declared)
      diagnostics.push({
        code: 'parameter-override-unknown',
        path: `spec.parameters.${name}`,
        message: `no parameter '${name}' to set`,
      })
    else if (typeof value !== declared.type)
      diagnostics.push({
        code: 'parameter-type-mismatch',
        path: `spec.parameters.${name}`,
        message: `must be a ${declared.type}`,
      })
    else values[name] = value
  }
  if (diagnostics.length > 0) throw new ManifestError(file, diagnostics)
  const plugins: Row[] = (raw.spec.rows ?? []).map((row) => ({
    id: row.id,
    use: row.name,
    ...(row.config === undefined
      ? {}
      : { config: substitute(row.config, values) as Record<string, unknown> }),
    ...(row.disabled === undefined ? {} : { disabled: row.disabled }),
  }))
  return { ...raw, plugins, values, digest: createHash('sha256').update(text).digest('hex') }
}

/** What an app can mount: a Cordis plugin per name. */
export type Registry = Readonly<Record<string, unknown>>

/**
 * Mount the manifest's enabled rows in order, each with its config merged under `overrides[id]` (runtime values such as the port win),
 * awaiting each one, because a fiber still waiting on an injected service reports done too early. Returns the fibers, in order.
 */
export async function compose(
  root: Context,
  manifest: Pick<ResolvedManifest, 'plugins'>,
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
