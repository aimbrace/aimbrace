/** Anything text can be written to. */
export interface Writer {
  write(text: string): unknown
}

/** Everything the CLI touches outside itself, injectable for tests. */
export interface Io {
  stdout: Writer
  stderr: Writer
  cwd: string
  /** Aborts when the user asks the process to stop (SIGINT, SIGTERM). Only `run` waits on it. */
  signal?: AbortSignal | undefined
}

/** Process-backed IO. The signal is wired lazily by `run` through {@link processSignal}. */
export function defaultIo(): Io {
  return { stdout: process.stdout, stderr: process.stderr, cwd: process.cwd() }
}

/** An AbortSignal that aborts on the first SIGINT or SIGTERM. Listeners are removed when it fires. */
export function processSignal(): AbortSignal {
  const controller = new AbortController()
  const abort = () => {
    process.off('SIGINT', abort)
    process.off('SIGTERM', abort)
    controller.abort()
  }
  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)
  return controller.signal
}
