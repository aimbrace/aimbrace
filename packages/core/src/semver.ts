/**
 * A deliberately small subset of semantic versioning, enough for plugin peer
 * ranges: exact versions, partial versions (`1`, `1.2`, `1.x`, `*`), carets,
 * tildes, comparators (`>=`, `>`, `<=`, `<`, `=`), AND via spaces and OR via
 * `||`. No hyphen ranges, no build metadata semantics.
 */

/** A parsed version. */
export interface Version {
  major: number
  minor: number
  patch: number
  prerelease: ReadonlyArray<string | number>
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Parse a full `major.minor.patch[-prerelease]` version, or return `undefined`. */
export function parseVersion(text: string): Version | undefined {
  const match = VERSION.exec(text.trim())
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]
      ? match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part))
      : [],
  }
}

/** Compare two versions: negative, zero or positive. Prereleases sort before the release. */
export function compareVersions(a: Version, b: Version): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index++) {
    const left = a.prerelease[index]
    const right = b.prerelease[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1
    if (typeof left === 'number') return -1
    if (typeof right === 'number') return 1
    return left < right ? -1 : 1
  }
  return 0
}

type Operator = '>=' | '>' | '<=' | '<' | '='
interface Comparator {
  operator: Operator
  version: Version
}
type ComparatorSet = Comparator[]

const PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/

interface Partial {
  major: number | undefined
  minor: number | undefined
  patch: number | undefined
  prerelease: ReadonlyArray<string | number>
}

function parsePartial(text: string): Partial | undefined {
  const match = PARTIAL.exec(text)
  if (!match) return undefined
  const part = (value: string | undefined): number | undefined =>
    value === undefined || /^[xX*]$/.test(value) ? undefined : Number(value)
  const major = part(match[1])
  const minor = major === undefined ? undefined : part(match[2])
  const patch = minor === undefined ? undefined : part(match[3])
  return {
    major,
    minor,
    patch,
    prerelease: match[4] ? match[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  }
}

const v = (major: number, minor: number, patch: number, prerelease: Version['prerelease'] = []) =>
  ({ major, minor, patch, prerelease }) satisfies Version

/** Expand one range token into comparators, or `undefined` when invalid. */
function expand(token: string): ComparatorSet | undefined {
  const operatorMatch = /^(\^|~|>=|<=|>|<|=)?\s*(.*)$/.exec(token)
  const operator = operatorMatch?.[1] ?? ''
  const partial = parsePartial(operatorMatch?.[2] ?? '')
  if (!partial) return undefined
  const { major, minor, patch, prerelease } = partial
  if (major === undefined) {
    // `*` and `x`: anything, but only without an operator that makes no sense
    return operator === '' || operator === '=' || operator === '>=' ? [] : undefined
  }
  const low = v(major, minor ?? 0, patch ?? 0, prerelease)
  const nextMajor = v(major + 1, 0, 0)
  const nextMinor = v(major, (minor ?? 0) + 1, 0)
  switch (operator) {
    case '^': {
      let high = nextMajor
      if (major === 0) {
        if (minor === undefined) high = nextMajor
        else if (minor === 0 && patch !== undefined) high = v(0, 0, patch + 1)
        else high = v(0, minor + 1, 0)
      }
      return [
        { operator: '>=', version: low },
        { operator: '<', version: high },
      ]
    }
    case '~':
      return [
        { operator: '>=', version: low },
        { operator: '<', version: minor === undefined ? nextMajor : nextMinor },
      ]
    case '>=':
      return [{ operator: '>=', version: low }]
    case '<=':
      return patch !== undefined
        ? [{ operator: '<=', version: low }]
        : [{ operator: '<', version: minor === undefined ? nextMajor : nextMinor }]
    case '>':
      return patch !== undefined
        ? [{ operator: '>', version: low }]
        : [{ operator: '>=', version: minor === undefined ? nextMajor : nextMinor }]
    case '<':
      return [{ operator: '<', version: low }]
    default: {
      if (patch !== undefined) return [{ operator: '=', version: low }]
      return [
        { operator: '>=', version: low },
        { operator: '<', version: minor === undefined ? nextMajor : nextMinor },
      ]
    }
  }
}

/** Parse a range into OR-ed sets of AND-ed comparators, or `undefined` when invalid. */
function parseRange(range: string): ComparatorSet[] | undefined {
  const sets: ComparatorSet[] = []
  for (const part of range.split('||')) {
    const tokens = part
      .trim()
      .replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1')
      .split(/\s+/)
      .filter(Boolean)
    const set: ComparatorSet = []
    if (tokens.length === 0) tokens.push('*')
    for (const token of tokens) {
      const comparators = expand(token)
      if (!comparators) return undefined
      set.push(...comparators)
    }
    sets.push(set)
  }
  return sets
}

/** True when `range` is syntactically valid. */
export function isValidRange(range: string): boolean {
  return parseRange(range) !== undefined
}

function test(version: Version, comparator: Comparator): boolean {
  const order = compareVersions(version, comparator.version)
  switch (comparator.operator) {
    case '>=':
      return order >= 0
    case '>':
      return order > 0
    case '<=':
      return order <= 0
    case '<':
      return order < 0
    case '=':
      return order === 0
  }
}

/**
 * True when `version` satisfies `range`. An invalid version or range never
 * satisfies. A prerelease version only satisfies a set that names a prerelease
 * of the same `major.minor.patch`.
 */
export function satisfies(version: string, range: string): boolean {
  const parsed = parseVersion(version)
  const sets = parseRange(range)
  if (!parsed || !sets) return false
  return sets.some((set) => {
    if (!set.every((comparator) => test(parsed, comparator))) return false
    if (parsed.prerelease.length === 0) return true
    return set.some(
      (comparator) =>
        comparator.version.prerelease.length > 0 &&
        comparator.version.major === parsed.major &&
        comparator.version.minor === parsed.minor &&
        comparator.version.patch === parsed.patch,
    )
  })
}
