import { INSTRUCTIONS_BY_NAME } from '../cpu/isa';
import { ExpressionError, parseExpression } from './expression';
import type { AssemblyDiagnostic, ParsedLine } from './types';

export function parseAssembly(source: string, diagnostics: AssemblyDiagnostic[]): ParsedLine[] {
  return source.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).map((raw, index) => {
    const line = index + 1;
    const code = raw.split(/;|\/\/|#/)[0] ?? '';
    const parsed: ParsedLine = { line, raw, labels: [], column: 1 };
    let offset = 0;
    while (offset < code.length) {
      const label = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(code.slice(offset));
      if (!label?.[1]) break;
      parsed.labels.push({ name: label[1].toUpperCase(), column: offset + label[0].indexOf(label[1]) + 1 });
      offset += label[0].length;
    }
    const operation = /^\s*(\S+)/.exec(code.slice(offset));
    if (!operation?.[1]) return parsed;
    const spelling = operation[1];
    parsed.operation = spelling.toUpperCase();
    parsed.column = offset + operation[0].indexOf(spelling) + 1;
    offset += operation[0].length;
    let operand = code.slice(offset).trim();
    let operandColumn = offset + (code.slice(offset).length - code.slice(offset).trimStart().length) + 1;
    const constantShorthand = /^\.EQU\b\s*/i.exec(operand);

    function error(message: string, column = parsed.column, diagnosticCode = 'syntax'): void {
      diagnostics.push({ line, column, message, code: diagnosticCode });
    }

    if (constantShorthand && /^[A-Za-z_][A-Za-z0-9_]*$/.test(spelling)) {
      parsed.constant = { name: spelling.toUpperCase(), column: parsed.column };
      parsed.operation = '.EQU';
      operandColumn += constantShorthand[0].length;
      operand = operand.slice(constantShorthand[0].length);
    } else if (parsed.operation === '.EQU') {
      const constant = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*|\s+)/.exec(operand);
      if (!constant?.[1]) {
        error('Use .EQU NAME, expression or NAME .EQU expression.', operandColumn);
        return parsed;
      }
      parsed.constant = { name: constant[1].toUpperCase(), column: operandColumn };
      operandColumn += constant[0].length;
      operand = operand.slice(constant[0].length);
    }
    if (parsed.operation === '.EQU' && parsed.labels.length) error('Constants use .EQU; a label cannot share that line.');

    const instruction = INSTRUCTIONS_BY_NAME.get(parsed.operation);
    const directive = ['.ORG', '.EQU', '.WORD'].includes(parsed.operation);
    if (!instruction && !directive) {
      error(`Unknown instruction or directive “${spelling}”.`, parsed.column, 'unknown-instruction');
      return parsed;
    }
    const needsOperand = directive || instruction?.operand;
    if (needsOperand && !operand) {
      error(`${parsed.operation} requires an operand.`, operandColumn, 'missing-operand');
      return parsed;
    }
    if (!needsOperand && operand) {
      error(`${parsed.operation} does not accept an operand.`, operandColumn, 'unexpected-operand');
      return parsed;
    }
    if (operand) {
      try { parsed.expression = parseExpression(operand, operandColumn); }
      catch (cause) {
        if (cause instanceof ExpressionError) error(cause.message, cause.column, 'expression');
        else throw cause;
      }
    }
    return parsed;
  });
}
