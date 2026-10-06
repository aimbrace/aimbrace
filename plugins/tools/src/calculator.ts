/**
 * A small arithmetic evaluator: numbers, `+ - * / % ^`, parentheses, unary
 * minus. A recursive descent parser, so no `eval` and no `Function`.
 */
export class CalculatorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalculatorError'
  }
}

type Token = { type: 'number'; value: number } | { type: 'op'; value: string }

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index] as string
    if (/\s/.test(char)) {
      index++
    } else if (/[0-9.]/.test(char)) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(source.slice(index))
      if (!match) throw new CalculatorError(`Unexpected "${char}" at position ${index + 1}.`)
      tokens.push({ type: 'number', value: Number(match[0]) })
      index += match[0].length
    } else if ('+-*/%^()'.includes(char)) {
      tokens.push({ type: 'op', value: char })
      index++
    } else {
      throw new CalculatorError(`Unexpected "${char}" at position ${index + 1}.`)
    }
  }
  return tokens
}

/** Evaluate an arithmetic expression. Throws {@link CalculatorError} with a readable message. */
export function calculate(source: string): number {
  const tokens = tokenize(source)
  if (tokens.length === 0) throw new CalculatorError('The expression is empty.')
  let position = 0
  const peek = () => tokens[position]
  const isOp = (value: string) => {
    const token = peek()
    return token?.type === 'op' && token.value === value
  }

  // expression := term (('+' | '-') term)*
  function expression(): number {
    let value = term()
    while (isOp('+') || isOp('-')) {
      const op = (tokens[position++] as { value: string }).value
      const right = term()
      value = op === '+' ? value + right : value - right
    }
    return value
  }
  // term := unary (('*' | '/' | '%') unary)*
  function term(): number {
    let value = unary()
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (tokens[position++] as { value: string }).value
      const right = unary()
      if ((op === '/' || op === '%') && right === 0) throw new CalculatorError('Division by zero.')
      value = op === '*' ? value * right : op === '/' ? value / right : value % right
    }
    return value
  }
  // unary := ('-' | '+') unary | power
  function unary(): number {
    if (isOp('-')) {
      position++
      return -unary()
    }
    if (isOp('+')) {
      position++
      return unary()
    }
    return power()
  }
  // power := primary ('^' unary)?   (right associative)
  function power(): number {
    const base = primary()
    if (isOp('^')) {
      position++
      return base ** unary()
    }
    return base
  }
  // primary := number | '(' expression ')'
  function primary(): number {
    const token = peek()
    if (!token) throw new CalculatorError('The expression ends too early.')
    if (token.type === 'number') {
      position++
      return token.value
    }
    if (token.value === '(') {
      position++
      const value = expression()
      if (!isOp(')')) throw new CalculatorError('Missing closing parenthesis.')
      position++
      return value
    }
    throw new CalculatorError(`Unexpected "${token.value}".`)
  }

  const value = expression()
  if (position < tokens.length) {
    const rest = tokens[position] as Token
    throw new CalculatorError(`Unexpected "${rest.type === 'number' ? rest.value : rest.value}".`)
  }
  if (!Number.isFinite(value)) throw new CalculatorError('The result is not a finite number.')
  return value
}

/** Format a result without float noise (`0.1 + 0.2` is `0.3`). */
export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)))
}
