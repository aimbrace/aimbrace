/** Long-term memory for the agent. In-process; swap it for a database plugin when you need persistence. */
export function memory(ctx) {
  const items = []
  ctx.provide('memory', {
    remember: (text) => void items.push(text),
    recall: () => [...items],
    size: () => items.length,
  })
}
