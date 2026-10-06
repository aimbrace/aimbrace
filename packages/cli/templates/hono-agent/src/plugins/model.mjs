/**
 * A deterministic model: no keys, no network, the same answer every time. Replace this plugin with a real provider when you
 * have one; the agent only needs `complete({ question, toolResult })` to return `{ text }` or `{ tool, args }`.
 */
export function model(ctx) {
  ctx.provide('model', {
    async complete({ question, toolResult }) {
      if (toolResult !== undefined) return { text: `The answer is ${toolResult}.` }
      const sum = /^add\s+(-?\d+)\s+(-?\d+)$/.exec(question.trim())
      if (sum) return { tool: 'add', args: [Number(sum[1]), Number(sum[2])] }
      return { text: `You said: ${question}` }
    },
  })
}
