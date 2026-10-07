import type { Context } from '@deepseek-ai/cordis'

/** Tools the agent may call. */
export interface Tools {
  list(): string[]
  call(name: string, args: number[]): unknown
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tools: Tools
  }
}

/** Add a function to `table` to give the model a new capability. */
export function tools(ctx: Context) {
  const table: Record<string, (...args: number[]) => unknown> = { add: (a = 0, b = 0) => a + b }
  ctx.provide(
    'tools',
    {
      list: () => Object.keys(table),
      call(name, args) {
        const run = table[name]
        if (!run) throw new Error(`unknown tool "${name}"`)
        return run(...args)
      },
    } satisfies Tools,
  )
}
