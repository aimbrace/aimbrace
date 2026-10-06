import { fileURLToPath } from 'node:url'
import { runCli } from '@aimbrace/cli'
import { describe, expect, it } from 'vitest'

const example = fileURLToPath(new URL('..', import.meta.url))

async function cli(args: string[]) {
  let out = ''
  let err = ''
  const code = await runCli([...args, '--cwd', example], {
    stdout: {
      write: (text) => {
        out += text
      },
    },
    stderr: {
      write: (text) => {
        err += text
      },
    },
  })
  return { code, out, err }
}

describe('examples/agent-cli', () => {
  it('has the dependency graph the architecture promises', async () => {
    const result = await cli(['graph'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('order model -> memory -> tools')
    expect(result.out).toContain('requires ai.model (from model)')
    const mermaid = await cli(['graph', '--format', 'mermaid'])
    expect(mermaid.out).toContain('p_model -->|ai.model| p_agent')
    expect(mermaid.out).toContain('p_tools -->|ai.tool-runner| p_agent')
  })

  it('validates', async () => {
    const result = await cli(['check'])
    expect(result.code).toBe(0)
    expect(result.out).toMatch(/^OK: 7 plugins/)
  })

  it('answers with a tool, showing the trace', async () => {
    const result = await cli(['ask', 'calc: 2 + 3 * 4', '--trace'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('[1] model: Calling calculator.')
    expect(result.out).toContain('[1] tool calculator: 14')
    expect(result.out).toContain('The answer is 14.')
    expect(result.out).toMatch(/\(completed, \d+ tokens\)/)
  })

  it('answers plain questions', async () => {
    const result = await cli(['ask', 'hello', 'there'])
    expect(result.out).toContain('You said: hello there')
  })

  it('reports the step limit and the token budget with a failing exit code', async () => {
    const steps = await cli(['ask', 'loop', '--steps', '2'])
    expect(steps.code).toBe(1)
    expect(steps.out).toContain('(max_steps,')
    const budget = await cli(['ask', 'loop', '--budget', '5', '--steps', '9'])
    expect(budget.code).toBe(1)
    expect(budget.out).toContain('(budget_exceeded,')
  })

  it('asks for a question', async () => {
    const result = await cli(['ask'])
    expect(result.code).toBe(2)
    expect(result.err).toContain('usage: aimbrace ask')
  })

  it('starts, shows the observed tree, and stops', async () => {
    const result = await cli(['run', '--once'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('Started "agent-cli" with 7 plugins')
    expect(result.out).toContain('  agent running')
    expect(result.out).toContain('Stopped')
  })

  it('lists the command the ask plugin contributes', async () => {
    const result = await cli(['commands'])
    expect(result.out).toContain(
      'ask <question...> [--budget N] [--steps N] [--trace]  Ask the agent a question',
    )
  })
})
