import { InvalidNameError } from '../errors'

const NAME = /^[A-Za-z][A-Za-z0-9._:/-]*$/

/** Throw `InvalidNameError` unless `name` is a valid token name. */
export function assertName(kind: string, name: unknown): asserts name is string {
  if (typeof name !== 'string' || !NAME.test(name)) throw new InvalidNameError(kind, name)
}
