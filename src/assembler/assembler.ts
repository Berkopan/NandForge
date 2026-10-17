import { INSTRUCTIONS_BY_NAME } from '../cpu/isa';
import { evaluateExpression, ExpressionError } from './expression';
import { parseAssembly } from './parser';
import type { AssemblyDiagnostic, AssemblyResult, Expression, ListingEntry, ParsedLine, SymbolLocation } from './types';

/** A positioned two-pass assembler. Failed assembly never reports an executable success. */
export function assemble(source: string): AssemblyResult {
  const rom = Array<number>(256).fill(0);
  const diagnostics: AssemblyDiagnostic[] = [];
  const listing: ListingEntry[] = [];
  const symbols: Record<string, number> = Object.create(null) as Record<string, number>;
  if (source.length > 200_000 || source.split('\n').length > 10_000) {
    return { ok: false, rom, listing, symbols, diagnostics: [{ line: 1, column: 1, code: 'source-size', message: 'Source is too large (maximum 200,000 characters and 10,000 lines).' }] };
  }
  const lines = parseAssembly(source, diagnostics);
  const declarations = new Map<string, { line: number; column: number }>();
  const constants = new Map<string, { expression: Expression; line: number; column: number }>();
  const labelValues = new Map<string, number>();
  const duplicatePositions = new Set<string>();

  function diagnostic(line: number, column: number, message: string, code: string): void {
    // A bad constant used several times should not flood the diagnostics panel with duplicates.
    if (!diagnostics.some((item) => item.line === line && item.column === column && item.message === message)) {
      diagnostics.push({ line, column, message, code });
    }
  }
  function declare(location: SymbolLocation, line: number): boolean {
    const previous = declarations.get(location.name);
    if (previous) {
      diagnostic(line, location.column, `Duplicate symbol “${location.name}”; first declared on line ${previous.line}.`, 'duplicate-symbol');
      duplicatePositions.add(`${line}:${location.column}`);
      return false;
    }
    declarations.set(location.name, { line, column: location.column });
    return true;
  }
  for (const line of lines) {
    for (const label of line.labels) declare(label, line.line);
    if (line.constant && declare(line.constant, line.line) && line.expression) {
      constants.set(line.constant.name, { expression: line.expression, line: line.line, column: line.constant.column });
    }
  }

  // Constants can refer forward to other constants; labels become available in the address pass.
  function evaluate(expression: Expression, line: number, allowForwardLabels: boolean): number | undefined {
    const resolving = new Set<string>();
    let errorLine = line;
    function resolve(name: string, column: number): number {
      const label = labelValues.get(name);
      if (label !== undefined) return label;
      const constant = constants.get(name);
      if (constant) {
        if (resolving.has(name)) throw new ExpressionError(`Cyclic .EQU definition involving “${name}”.`, column);
        if (resolving.size >= 128) throw new ExpressionError('Constant dependency chain is too deep (maximum 128).', column);
        resolving.add(name);
        const previousLine = errorLine;
        errorLine = constant.line;
        const value = evaluateExpression(constant.expression, resolve);
        errorLine = previousLine;
        resolving.delete(name);
        return value;
      }
      if (!allowForwardLabels && declarations.has(name)) {
        throw new ExpressionError(`.ORG cannot depend on the unresolved forward label “${name}”.`, column);
      }
      throw new ExpressionError(`Undefined symbol “${name}”.`, column);
    }
    try { return evaluateExpression(expression, resolve); }
    catch (cause) {
      if (cause instanceof ExpressionError) diagnostic(errorLine, cause.column, cause.message, 'symbol');
      else throw cause;
      return undefined;
    }
  }

  let address = 0;
  const occupied = new Map<number, number>();
  for (const line of lines) {
    for (const label of line.labels) {
      if (!duplicatePositions.has(`${line.line}:${label.column}`)) {
        labelValues.set(label.name, address);
        if (address > 255) diagnostic(line.line, label.column, 'A label address must be inside ROM (0–255).', 'address-range');
      }
    }
    if (line.operation === '.ORG' && line.expression) {
      const target = evaluate(line.expression, line.line, false);
      if (target !== undefined) {
        if (target < 0 || target > 255) diagnostic(line.line, line.expression.column, '.ORG address must be between 0 and 255.', 'address-range');
        else address = target;
      }
    } else if (line.operation && line.operation !== '.EQU' && line.operation !== '.ORG') {
      if (!INSTRUCTIONS_BY_NAME.has(line.operation) && line.operation !== '.WORD') continue;
      line.address = address;
      if (address > 255) diagnostic(line.line, line.column, 'Program exceeds the 256-instruction ROM.', 'program-size');
      else {
        const previous = occupied.get(address);
        if (previous !== undefined) diagnostic(line.line, line.column, `ROM address ${address} overlaps the instruction on line ${previous}.`, 'address-overlap');
        else occupied.set(address, line.line);
      }
      address += 1;
    }
  }
  for (const [name, value] of labelValues) symbols[name] = value;
  for (const [name, constant] of constants) {
    const value = evaluate(constant.expression, constant.line, true);
    if (value !== undefined) symbols[name] = value;
  }

  function emit(line: ParsedLine): void {
    if (line.address === undefined || line.address > 255 || !line.operation) return;
    const instruction = INSTRUCTIONS_BY_NAME.get(line.operation);
    let operand = 0;
    if (instruction?.operand || line.operation === '.WORD') {
      if (!line.expression) return;
      const value = evaluate(line.expression, line.line, true);
      if (value === undefined) return;
      const max = line.operation === '.WORD' ? 65535 : 255;
      if (value < 0 || value > max) {
        diagnostic(line.line, line.expression.column, `${line.operation} operand must be between 0 and ${max}; received ${value}.`, 'operand-range');
        return;
      }
      operand = value;
    }
    const word = line.operation === '.WORD' ? operand : ((instruction?.opcode ?? 0) << 8) | operand;
    rom[line.address] = word;
    listing.push({ address: line.address, word, line: line.line, column: line.column, source: line.raw, mnemonic: line.operation });
  }
  lines.forEach(emit);
  diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
  return { ok: diagnostics.length === 0, rom, listing, diagnostics, symbols };
}
