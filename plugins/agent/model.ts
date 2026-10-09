import type { Context } from '@deepseek-ai/cordis'

/** One model step: either final text, or a tool to call with its arguments. */
export type Step = { text: string; tool?: undefined } | { tool: string; args: number[] }

/** What the agent needs from a model. Replace this plugin with a real provider when you have one. */
export interface Model {
  complete(input: { question: string; toolResult?: unknown }): Promise<Step>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    model: Model
  }
}

/** A deterministic model: no keys, no network, the same answer every time. */
export function model(ctx: Context) {
  ctx.provide('model', {
    complete({ question, toolResult }) {
      if (toolResult !== undefined) {
        return Promise.resolve({ text: `The answer is ${toolResult}.` })
      }
      const sum = /^add\s+(-?\d+)\s+(-?\d+)$/.exec(question.trim())
      if (sum) return Promise.resolve({ tool: 'add', args: [Number(sum[1]), Number(sum[2])] })
      return Promise.resolve({ text: `You said: ${question}` })
    },
  } satisfies Model)
}
