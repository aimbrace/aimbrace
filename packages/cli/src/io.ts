/** Everything the CLI touches besides the files it copies. Tests pass their own. */
export interface Io {
  stdout(text: string): void
  stderr(text: string): void
  cwd: string
  /** Ask one question; `undefined` when there is no terminal to ask on. */
  ask: ((question: string) => string) | undefined
  /** Fetch the project's dependencies; resolves to the exit code. */
  install(directory: string): Promise<number>
}

const encoder = new TextEncoder()

/** The real terminal, and `deno install` for dependencies. */
export function processIo(): Io {
  const interactive = Deno.stdin.isTerminal() && Deno.stdout.isTerminal()
  return {
    stdout: (text) => void Deno.stdout.writeSync(encoder.encode(text)),
    stderr: (text) => void Deno.stderr.writeSync(encoder.encode(text)),
    cwd: Deno.cwd(),
    ask: interactive ? (question) => prompt(question) ?? '' : undefined,
    async install(directory) {
      const { code } = await new Deno.Command(Deno.execPath(), {
        args: ['install'],
        cwd: directory,
        stdout: 'inherit',
        stderr: 'inherit',
      }).output()
      return code
    },
  }
}
