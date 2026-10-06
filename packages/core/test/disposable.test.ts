import { describe, expect, it } from 'vitest'
import { DisposalError, DisposedError, DisposerStack } from '../src'

describe('DisposerStack', () => {
  it('runs disposers last-in first-out', async () => {
    const order: number[] = []
    const stack = new DisposerStack()
    stack.own(() => void order.push(1))
    stack.own(async () => {
      await Promise.resolve()
      order.push(2)
    })
    stack.own(() => void order.push(3))
    await stack.dispose()
    expect(order).toEqual([3, 2, 1])
    expect(stack.size).toBe(0)
  })

  it('awaits each async disposer before starting the next', async () => {
    const log: string[] = []
    const stack = new DisposerStack()
    stack.own(() => void log.push('second-done'))
    stack.own(async () => {
      log.push('first-start')
      await new Promise((resolve) => setTimeout(resolve, 5))
      log.push('first-done')
    })
    await stack.dispose()
    expect(log).toEqual(['first-start', 'first-done', 'second-done'])
  })

  it('runs every disposer even when some throw, then reports all failures', async () => {
    const ran: string[] = []
    const stack = new DisposerStack()
    stack.own(() => void ran.push('a'))
    stack.own(() => {
      ran.push('b')
      throw new Error('b failed')
    })
    stack.own(async () => {
      ran.push('c')
      throw new Error('c failed')
    })
    const failure = await stack.dispose().catch((error: unknown) => error)
    expect(ran).toEqual(['c', 'b', 'a'])
    expect(failure).toBeInstanceOf(DisposalError)
    expect((failure as DisposalError).errors.map((e) => (e as Error).message)).toEqual([
      'c failed',
      'b failed',
    ])
    expect((failure as DisposalError).code).toBe('E_DISPOSAL')
  })

  it('is idempotent and returns the same disposal', async () => {
    let calls = 0
    const stack = new DisposerStack()
    stack.own(() => void calls++)
    const first = stack.dispose()
    const second = stack.dispose()
    expect(first).toBe(second)
    await first
    await stack.dispose()
    expect(calls).toBe(1)
    expect(stack.disposed).toBe(true)
  })

  it('refuses new disposers after disposal', async () => {
    const stack = new DisposerStack()
    await stack.dispose()
    expect(() => stack.own(() => {})).toThrow(DisposedError)
  })

  it('lets a disposer be unregistered without running it', async () => {
    let ran = false
    const stack = new DisposerStack()
    const forget = stack.own(() => {
      ran = true
    })
    forget()
    await stack.dispose()
    expect(ran).toBe(false)
  })

  it('supports `await using`', async () => {
    let ran = false
    {
      await using stack = new DisposerStack()
      stack.own(() => {
        ran = true
      })
    }
    expect(ran).toBe(true)
  })
})
