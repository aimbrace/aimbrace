import * as v from 'valibot'
import type { HttpAddress } from './tokens'

/** Options every HTTP host accepts. Hosts validate them with this Standard Schema. */
export const HostConfig = v.object({
  /** Port to listen on. `0` picks a free port. */
  port: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(65535)), 3000),
  hostname: v.optional(v.string(), '127.0.0.1'),
  /** Set to `false` to build the host without opening a socket (useful with `dispatcher.dispatch` in tests). */
  listen: v.optional(v.boolean(), true),
  /** Milliseconds to let in-flight connections finish when stopping before they are cut. */
  shutdownGraceMs: v.optional(v.pipe(v.number(), v.minValue(0)), 1000),
})

/** The validated host options. */
export type HostOptions = v.InferOutput<typeof HostConfig>

/** The options a caller may pass (everything optional). */
export type HostInput = v.InferInput<typeof HostConfig>

/**
 * The holder behind the {@link HttpAddress} service. Hosts provide `view`
 * during `setup` and call `set` once they are listening.
 */
export interface AddressHolder {
  readonly view: HttpAddress
  set(hostname: string, port: number): void
  clear(): void
}

export function createAddressHolder(): AddressHolder {
  let hostname: string | undefined
  let port: number | undefined
  return {
    view: {
      get hostname() {
        return hostname
      },
      get port() {
        return port
      },
      get url() {
        if (hostname === undefined || port === undefined) return undefined
        return `http://${hostname.includes(':') ? `[${hostname}]` : hostname}:${port}`
      },
    },
    set(nextHostname, nextPort) {
      hostname = nextHostname
      port = nextPort
    },
    clear() {
      hostname = undefined
      port = undefined
    },
  }
}
