/**
 * Upgrading a Blend: what happens when its Blueprint moves to a new version.
 *
 * ACRYL's Blends keep a `lineage` (which Blueprint, which version) but do not say what an upgrade means. This is the proposal the
 * prototype tests: an upgrade is a *plan* before it is an action.
 *
 * 1. Resolve the Blend over the old Blueprint and over the new one (the Blueprint's own parents resolve as usual).
 * 2. `blueprintChanges`: what changed in the Blueprint (rows added, removed, or changed in name, config or disabled).
 * 3. `conflicts`: what the Blend can no longer do on the new Blueprint, as ACRYL's own diagnostics: an override of a row that no
 *    longer exists (`override-unknown-id`), an own row whose id the Blueprint now uses (`insert-id-collision`).
 * 4. `shadowed`: Blueprint changes the Blend's overrides hide (the override sets the same key, so the change has no effect here).
 * 5. `appChanges`: how the rows the app mounts differ after the upgrade, so the owner sees the effect, not just the Blueprint diff.
 *
 * Only a plan with no conflicts is `safe`. Applying it moves `spec.lineage.blueprintVersion` and nothing else, keeping the file's
 * comments: the rows come from the Blueprint at resolution time, so the Blend file stays the owner's.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { parse, parseDocument } from 'yaml'
import {
  type Diagnostic,
  type LoadOptions,
  type Manifest,
  ManifestError,
  type Row,
  resolveRows,
  validate,
} from './index.ts'

export interface RowChange {
  readonly id: string
  readonly change: 'added' | 'removed' | 'changed'
  /** For a changed row: which of `name`, `config`, `disabled` differ. */
  readonly fields?: readonly string[]
}

export interface UpgradePlan {
  readonly blueprint: string
  readonly from: string
  readonly to: string
  readonly blueprintChanges: readonly RowChange[]
  readonly conflicts: readonly Diagnostic[]
  readonly shadowed: ReadonlyArray<{ readonly id: string; readonly keys: readonly string[] }>
  readonly appChanges: readonly RowChange[]
  /** No conflicts: the Blend resolves cleanly over the new Blueprint. */
  readonly safe: boolean
}

function load(file: string): Manifest {
  const document = parse(readFileSync(file, 'utf8')) as unknown
  const problems = validate(document)
  if (problems.length > 0) throw new ManifestError(file, problems)
  return document as Manifest
}

/** The rows of a document with its parents resolved and its parameters at their defaults. */
function rowsOf(
  document: Manifest,
  getBlueprint: LoadOptions['getBlueprint'],
  problems: Diagnostic[],
  values?: LoadOptions['values'],
): Row[] {
  return resolveRows(
    document,
    { ...(getBlueprint ? { getBlueprint } : {}), ...(values ? { values } : {}) },
    [document.metadata.id],
    problems,
  ).rows
}

function diffRows(before: readonly Row[], after: readonly Row[]): RowChange[] {
  const changes: RowChange[] = []
  const was = new Map(before.map((row) => [row.id, row]))
  const is = new Map(after.map((row) => [row.id, row]))
  for (const row of before) if (!is.has(row.id)) changes.push({ id: row.id, change: 'removed' })
  for (const row of after) {
    const old = was.get(row.id)
    if (!old) {
      changes.push({ id: row.id, change: 'added' })
      continue
    }
    const fields = [
      ...(old.use === row.use ? [] : ['name']),
      ...(isDeepStrictEqual(old.config ?? {}, row.config ?? {}) ? [] : ['config']),
      ...((old.disabled ?? false) === (row.disabled ?? false) ? [] : ['disabled']),
    ]
    if (fields.length > 0) changes.push({ id: row.id, change: 'changed', fields })
  }
  return changes
}

/**
 * Plan the upgrade of the Blend in `blendFile` from the Blueprint file it was made from (`oldBlueprint`) to a newer one
 * (`newBlueprint`). `getBlueprint` finds the parents of either Blueprint, if they have any. Throws only for input that cannot be
 * read as a plan: a Blueprint file with the wrong id, an old Blueprint whose version is not the Blend's lineage version, or a
 * document that is not a Blend. Everything the upgrade would break is in the plan.
 */
export function planUpgrade(options: {
  blendFile: string
  oldBlueprint: string
  newBlueprint: string
  getBlueprint?: LoadOptions['getBlueprint']
  values?: LoadOptions['values']
}): UpgradePlan {
  const blend = load(options.blendFile)
  const lineage = blend.spec.lineage
  if (blend.kind !== 'Blend' || !lineage)
    throw new Error(
      `${options.blendFile} is a ${blend.kind}; an upgrade applies to a Blend (it needs a spec.lineage)`,
    )
  const oldDocument = load(options.oldBlueprint)
  const newDocument = load(options.newBlueprint)
  for (const [label, document] of [
    ['old', oldDocument],
    ['new', newDocument],
  ] as const) {
    if (document.metadata.id !== lineage.blueprint)
      throw new Error(
        `the ${label} Blueprint is '${document.metadata.id}' but this Blend is made from '${lineage.blueprint}'`,
      )
  }
  if (oldDocument.metadata.version !== lineage.blueprintVersion)
    throw new Error(
      `the old Blueprint is version ${oldDocument.metadata.version} but this Blend's lineage says ${lineage.blueprintVersion}`,
    )

  const serving = (file: string) => (id: string) =>
    id === lineage.blueprint ? file : options.getBlueprint?.(id)
  const none: Diagnostic[] = []
  const blueprintChanges = diffRows(
    rowsOf(oldDocument, options.getBlueprint, none),
    rowsOf(newDocument, options.getBlueprint, none),
  )
  if (none.length > 0) throw new ManifestError('a Blueprint', none)

  const before: Diagnostic[] = []
  const after: Diagnostic[] = []
  const beforeRows = resolveRows(
    blend,
    {
      getBlueprint: serving(options.oldBlueprint),
      ...(options.values ? { values: options.values } : {}),
    },
    [blend.metadata.id],
    before,
  ).rows
  const afterRows = resolveRows(
    blend,
    {
      getBlueprint: serving(options.newBlueprint),
      ...(options.values ? { values: options.values } : {}),
    },
    [blend.metadata.id],
    after,
  ).rows
  if (before.length > 0) throw new ManifestError(options.blendFile, before)

  const changed = new Map(
    blueprintChanges.filter((c) => c.change === 'changed').map((c) => [c.id, c.fields ?? []]),
  )
  const shadowed = (blend.spec.overrides ?? []).flatMap((entry) => {
    const fields = changed.get(entry.id)
    if (!fields) return []
    const keys = [
      ...(fields.includes('name') && entry.name !== undefined ? ['name'] : []),
      ...(fields.includes('disabled') && entry.disabled !== undefined ? ['disabled'] : []),
      ...(fields.includes('config') && entry.config ? Object.keys(entry.config) : []),
    ]
    return keys.length > 0 ? [{ id: entry.id, keys }] : []
  })
  return {
    blueprint: lineage.blueprint,
    from: lineage.blueprintVersion,
    to: newDocument.metadata.version,
    blueprintChanges,
    conflicts: after,
    shadowed,
    appChanges: after.length > 0 ? [] : diffRows(beforeRows, afterRows),
    safe: after.length === 0,
  }
}

/** Move the Blend's lineage to the plan's new version, keeping the file's comments and layout. Refuses an unsafe plan. */
export function applyUpgrade(blendFile: string, plan: UpgradePlan): void {
  if (!plan.safe)
    throw new Error(
      `the upgrade to ${plan.to} has ${plan.conflicts.length} conflict(s); resolve them first`,
    )
  const document = parseDocument(readFileSync(blendFile, 'utf8'))
  if (document.getIn(['spec', 'lineage', 'blueprintVersion']) !== plan.from)
    throw new Error(`${blendFile} no longer says it is at ${plan.from}; plan again`)
  document.setIn(['spec', 'lineage', 'blueprintVersion'], plan.to)
  writeFileSync(blendFile, String(document))
}

/** A short, readable account of a plan, for a terminal. */
export function describePlan(plan: UpgradePlan): string {
  const line = (change: RowChange) =>
    `  ${change.change.padEnd(7)} ${change.id}${change.fields ? ` (${change.fields.join(', ')})` : ''}`
  const lines = [`${plan.blueprint}: ${plan.from} -> ${plan.to}`]
  lines.push(
    plan.blueprintChanges.length ? 'the Blueprint changed:' : 'the Blueprint has no row changes',
    ...plan.blueprintChanges.map(line),
  )
  if (plan.shadowed.length)
    lines.push(
      'your overrides hide some of that:',
      ...plan.shadowed.map((entry) => `  ${entry.id}: ${entry.keys.join(', ')}`),
    )
  if (plan.conflicts.length)
    lines.push(
      'this Blend would break:',
      ...plan.conflicts.map((conflict) => `  ${conflict.path}: ${conflict.message}`),
    )
  else
    lines.push(
      plan.appChanges.length ? 'your app would change:' : 'your app would not change',
      ...plan.appChanges.map(line),
    )
  lines.push(plan.safe ? 'safe to apply' : 'NOT safe: resolve the conflicts first')
  return lines.join('\n')
}
