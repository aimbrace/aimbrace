import { describe, expect, it } from 'vitest'
import { compareVersions, isValidRange, parseVersion, satisfies } from '../src'

describe('parseVersion', () => {
  it('parses full versions, v prefix, prerelease and build metadata', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseVersion('v0.0.1')?.patch).toBe(1)
    expect(parseVersion('1.0.0-beta.2+build5')?.prerelease).toEqual(['beta', 2])
  })

  it.each(['1', '1.2', 'x.y.z', '', '1.2.3.4'])('rejects %j', (text) => {
    expect(parseVersion(text)).toBeUndefined()
  })
})

describe('compareVersions', () => {
  const c = (a: string, b: string) => Math.sign(compareVersions(parseVersion(a)!, parseVersion(b)!))

  it('orders numerically, not lexically', () => {
    expect(c('1.10.0', '1.9.0')).toBe(1)
    expect(c('2.0.0', '10.0.0')).toBe(-1)
    expect(c('1.2.3', '1.2.3')).toBe(0)
  })

  it('sorts prereleases before the release and by identifier rules', () => {
    expect(c('1.0.0-alpha', '1.0.0')).toBe(-1)
    expect(c('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
    expect(c('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1)
    expect(c('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1)
    expect(c('1.0.0-rc.1', '1.0.0-beta.9')).toBe(1)
  })
})

describe('satisfies', () => {
  it.each([
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '1.2.3', false],
    ['1.2.3', '=1.2.3', true],
    ['1.5.0', '1', true],
    ['2.0.0', '1', false],
    ['1.2.9', '1.2', true],
    ['1.3.0', '1.2.x', false],
    ['9.9.9', '*', true],
    ['9.9.9', 'x', true],
    ['1.2.3', '>=1.2.3', true],
    ['1.2.2', '>=1.2.3', false],
    ['1.2.4', '>1.2.3', true],
    ['1.2.3', '>1.2.3', false],
    ['1.2.3', '<=1.2.3', true],
    ['1.2.3', '<1.2.3', false],
    ['1.2.3', '>=1.0.0 <2.0.0', true],
    ['2.0.0', '>=1.0.0 <2.0.0', false],
    ['3.1.0', '^1.0.0 || ^3.0.0', true],
    ['2.1.0', '^1.0.0 || ^3.0.0', false],
  ])('%s against %s is %s', (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected)
  })

  it.each([
    ['1.9.9', '^1.2.3', true],
    ['1.2.2', '^1.2.3', false],
    ['2.0.0', '^1.2.3', false],
    ['0.2.9', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['1.9.0', '^1.2', true],
    ['0.9.0', '^0', true],
    ['1.0.0', '^0', false],
  ])('caret: %s against %s is %s', (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected)
  })

  it.each([
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.9.0', '~1', true],
    ['2.0.0', '~1', false],
    ['1.2.5', '~1.2', true],
  ])('tilde: %s against %s is %s', (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected)
  })

  it('applies the npm prerelease rule', () => {
    expect(satisfies('1.2.3-beta.1', '^1.2.0')).toBe(false)
    expect(satisfies('1.2.3-beta.1', '^1.2.3-beta.0')).toBe(true)
    expect(satisfies('1.2.4-beta.1', '^1.2.3-beta.0')).toBe(false)
    expect(satisfies('1.2.3', '^1.2.3-beta.0')).toBe(true)
  })

  it('never satisfies with an invalid version or range', () => {
    expect(satisfies('nope', '*')).toBe(false)
    expect(satisfies('1.0.0', '^^1')).toBe(false)
    expect(satisfies('1.0.0', '>=')).toBe(false)
  })

  it('validates ranges', () => {
    expect(isValidRange('^1.2.3 || >=4')).toBe(true)
    expect(isValidRange('>= 1.2.3')).toBe(true)
    expect(isValidRange('banana')).toBe(false)
  })
})
