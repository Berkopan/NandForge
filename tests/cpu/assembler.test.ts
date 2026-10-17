import { describe, expect, it } from 'vitest';
import { assemble, EXAMPLE_PROGRAMS } from '../../src/assembler';
import { INSTRUCTION_SET } from '../../src/cpu/isa';

describe('two-pass assembly', () => {
  it('encodes the mandatory addition program, with a complete 256-word ROM', () => {
    const result = assemble('LDI 3\nSTA 240\nLDI 4\nADD 240\nOUT\nHLT');
    expect(result.ok).toBe(true);
    expect(result.rom).toHaveLength(256);
    expect(result.rom.slice(0, 6)).toEqual([0x0103, 0x03f0, 0x0104, 0x04f0, 0x1000, 0xff00]);
    expect(result.rom.slice(6).every((word) => word === 0)).toBe(true);
    expect(result.listing.map(({ address, line }) => [address, line])).toEqual([[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]]);
  });

  it('supports case-insensitivity, forward labels, comments, tabs and every newline style', () => {
    const result = assemble('\ufeff; note\r\n\tJmP Finish // jump\r\nstart: ldi 0b10101010\rFinish:\tOUT # output\rHLT');
    expect(result.diagnostics).toEqual([]);
    expect(result.rom.slice(0, 4)).toEqual([0x0c02, 0x01aa, 0x1000, 0xff00]);
    expect(result.symbols).toEqual({ START: 1, FINISH: 2 });
    expect(result.listing[0]).toMatchObject({ line: 2, column: 2, address: 0 });
  });

  it('assembles all instruction encodings independently of one another', () => {
    for (const spec of INSTRUCTION_SET) {
      const result = assemble(spec.mnemonic + (spec.operand ? ' 0xA5' : ''));
      expect(result.diagnostics).toEqual([]);
      expect(result.rom[0]).toBe((spec.opcode << 8) | (spec.operand ? 0xa5 : 0));
    }
  });

  it('resolves forward constants and arithmetic expressions, preserving sparse ROM addresses', () => {
    const result = assemble('.EQU BASE, ADDRESS + 1\nADDRESS .EQU 0x1f\n.ORG BASE\nfirst: LDI (0b1000 + 2) - 1\nJMP end\n.ORG 255\nend: HLT');
    expect(result.diagnostics).toEqual([]);
    expect(result.rom[32]).toBe(0x0109);
    expect(result.rom[33]).toBe(0x0cff);
    expect(result.rom[255]).toBe(0xff00);
    expect(result.symbols).toEqual({ BASE: 32, ADDRESS: 31, FIRST: 32, END: 255 });
  });

  it('allows constants to refer to forward labels when they do not control .ORG', () => {
    const result = assemble('.EQU DEST, done + 1\nJMP DEST\ndone: NOP\nHLT');
    expect(result.ok).toBe(true);
    expect(result.rom[0]).toBe(0x0c02);
    expect(result.symbols.DEST).toBe(2);
  });

  it('supports raw .WORD for hardware fault experiments', () => {
    const result = assemble('.WORD 0xABCD\n.WORD 65535\n.WORD 0b1000000000000000');
    expect(result.ok).toBe(true);
    expect(result.rom.slice(0, 3)).toEqual([0xabcd, 65535, 32768]);
  });

  it('accepts exactly 256 instructions and rejects the 257th at its source position', () => {
    expect(assemble(Array<string>(256).fill('NOP').join('\n')).ok).toBe(true);
    const result = assemble(Array<string>(257).fill('NOP').join('\n'));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ line: 257, column: 1, code: 'program-size' }));
  });

  it.each([
    ['LDI', 'requires an operand'],
    ['HLT 7', 'does not accept an operand'],
    ['LDI 256', 'between 0 and 255'],
    ['LDI -1', 'between 0 and 255'],
    ['LDA 1.5', 'Unexpected character'],
    ['LDI 0b102', 'Unexpected token'],
    ['LDI 0xZZ', 'Unexpected token'],
    ['LDI 3 4', 'Unexpected token'],
    ['LDI (3 + 4', 'closing parenthesis'],
    ['JMP nowhere', 'Undefined symbol'],
    ['MOV 1', 'Unknown instruction'],
    ['x: NOP\nx: HLT', 'Duplicate symbol'],
    ['.EQU X, 3\nx: HLT', 'Duplicate symbol'],
    ['.ORG 256', 'between 0 and 255'],
    ['NOP\n.ORG 0\nHLT', 'overlaps'],
    ['.ORG later\nlater: HLT', 'unresolved forward label'],
    ['.EQU X, Y\n.EQU Y, X\nLDI X', 'Cyclic .EQU'],
    ['.WORD 65536', 'between 0 and 65535'],
    ['.EQU 7, 2', 'Use .EQU'],
    ['x: .EQU Y, 2', 'cannot share that line'],
  ])('rejects invalid source %s with meaningful diagnostics', (source, message) => {
    const result = assemble(source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes(message))).toBe(true);
    expect(result.diagnostics.every((diagnostic) => diagnostic.line > 0 && diagnostic.column > 0)).toBe(true);
  });

  it('reports exact positions, including operands after indented labels', () => {
    const result = assemble('; first\n   label:   LDI missing');
    expect(result.diagnostics).toEqual([expect.objectContaining({ line: 2, column: 17, message: 'Undefined symbol “MISSING”.' })]);
  });

  it('treats symbol names as data, including names resembling object properties', () => {
    const result = assemble('__proto__: NOP\nconstructor: JMP __proto__\n.EQU TO_STRING, 8\nLDI to_string');
    expect(result.ok).toBe(true);
    expect(result.rom.slice(0, 3)).toEqual([0, 0x0c00, 0x0108]);
  });

  it('bounds pathological input and expression nesting', () => {
    expect(assemble(' '.repeat(200_001)).diagnostics[0]?.code).toBe('source-size');
    expect(assemble(`LDI ${'('.repeat(40)}1${')'.repeat(40)}`).ok).toBe(false);
  });

  it.each(EXAMPLE_PROGRAMS)('assembles the real $name example', (example) => {
    const result = assemble(example.source);
    expect(result.diagnostics).toEqual([]);
    expect(result.listing.length).toBeGreaterThan(2);
  });
});
