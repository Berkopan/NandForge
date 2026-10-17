import type { Expression } from './types';

export class ExpressionError extends Error {
  constructor(message: string, readonly column: number) { super(message); }
}

interface Token { value: string; column: number }

/** Small, bounded arithmetic grammar: decimal/hex/binary, symbols, unary signs, +/-, parentheses. */
export function parseExpression(source: string, startColumn: number): Expression {
  const tokens: Token[] = [];
  const pattern = /\s+|0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+|[A-Za-z_][A-Za-z0-9_]*|[()+-]/gy;
  let offset = 0;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) throw new ExpressionError(`Unexpected character “${source[offset]}” in expression.`, startColumn + offset);
    if (!/^\s+$/.test(match[0])) tokens.push({ value: match[0], column: startColumn + offset });
    offset = pattern.lastIndex;
  }
  if (tokens.length > 256) throw new ExpressionError('Expression is too complex (maximum 256 tokens).', startColumn);
  let cursor = 0;
  function primary(depth: number): Expression {
    if (depth > 32) throw new ExpressionError('Expression nesting is too deep (maximum 32).', tokens[cursor]?.column ?? startColumn);
    const token = tokens[cursor++];
    if (!token) throw new ExpressionError('Expected a number, symbol, or parenthesized expression.', startColumn + source.length);
    if (token.value === '+' || token.value === '-') {
      return { kind: 'unary', operator: token.value, expression: primary(depth + 1), column: token.column };
    }
    if (token.value === '(') {
      const expression = sum(depth + 1);
      if (tokens[cursor]?.value !== ')') throw new ExpressionError('Expected closing parenthesis.', tokens[cursor]?.column ?? startColumn + source.length);
      cursor += 1;
      return expression;
    }
    if (/^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)$/.test(token.value)) {
      const value = Number(token.value);
      if (!Number.isSafeInteger(value)) throw new ExpressionError('Integer is too large to represent exactly.', token.column);
      return { kind: 'number', value, column: token.column };
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token.value)) {
      return { kind: 'symbol', name: token.value.toUpperCase(), column: token.column };
    }
    throw new ExpressionError('Expected a number or symbol.', token.column);
  }
  function sum(depth: number): Expression {
    let left = primary(depth);
    while (tokens[cursor]?.value === '+' || tokens[cursor]?.value === '-') {
      const token = tokens[cursor++];
      if (!token || (token.value !== '+' && token.value !== '-')) break;
      left = { kind: 'binary', operator: token.value, left, right: primary(depth), column: token.column };
    }
    return left;
  }
  const expression = sum(0);
  const remaining = tokens[cursor];
  if (remaining) throw new ExpressionError(`Unexpected token “${remaining.value}”; separate instructions with a new line.`, remaining.column);
  return expression;
}

export function evaluateExpression(expression: Expression, symbol: (name: string, column: number) => number): number {
  let value: number;
  if (expression.kind === 'number') value = expression.value;
  else if (expression.kind === 'symbol') value = symbol(expression.name, expression.column);
  else if (expression.kind === 'unary') {
    const operand = evaluateExpression(expression.expression, symbol);
    value = expression.operator === '-' ? -operand : operand;
  } else {
    const left = evaluateExpression(expression.left, symbol);
    const right = evaluateExpression(expression.right, symbol);
    value = expression.operator === '+' ? left + right : left - right;
  }
  if (!Number.isSafeInteger(value)) throw new ExpressionError('Expression is outside the exact integer range.', expression.column);
  return value;
}
