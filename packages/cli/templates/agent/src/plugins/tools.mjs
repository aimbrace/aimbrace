/** Tools the agent may call. Add a function here to give the model a new capability. */
export function tools(ctx) {
  const table = { add: (a, b) => a + b }
  ctx.provide('tools', {
    list: () => Object.keys(table),
    call(name, args) {
      const run = table[name]
      if (!run) throw new Error(`unknown tool "${name}"`)
      return run(...args)
    },
  })
}
