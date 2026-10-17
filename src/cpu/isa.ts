/** The instruction table is metadata, never an execution engine. */
export const INSTRUCTION_SET = [
  { opcode: 0x00, mnemonic: 'NOP', operand: false, description: 'Advance to the next instruction.' },
  { opcode: 0x01, mnemonic: 'LDI', operand: true, description: 'Load an immediate byte into A.' },
  { opcode: 0x02, mnemonic: 'LDA', operand: true, description: 'Load a RAM byte into A.' },
  { opcode: 0x03, mnemonic: 'STA', operand: true, description: 'Store A in RAM.' },
  { opcode: 0x04, mnemonic: 'ADD', operand: true, description: 'Add RAM to A; carry records overflow.' },
  { opcode: 0x05, mnemonic: 'SUB', operand: true, description: 'Subtract RAM from A; carry means no borrow.' },
  { opcode: 0x06, mnemonic: 'AND', operand: true, description: 'Bitwise AND A with RAM.' },
  { opcode: 0x07, mnemonic: 'OR', operand: true, description: 'Bitwise OR A with RAM.' },
  { opcode: 0x08, mnemonic: 'XOR', operand: true, description: 'Bitwise XOR A with RAM.' },
  { opcode: 0x09, mnemonic: 'NOT', operand: false, description: 'Invert every bit of A.' },
  { opcode: 0x0a, mnemonic: 'SHL', operand: false, description: 'Shift A left; carry receives the former bit 7.' },
  { opcode: 0x0b, mnemonic: 'SHR', operand: false, description: 'Shift A right; carry receives the former bit 0.' },
  { opcode: 0x0c, mnemonic: 'JMP', operand: true, description: 'Jump to an instruction address.' },
  { opcode: 0x0d, mnemonic: 'JZ', operand: true, description: 'Jump if the stored zero flag is one.' },
  { opcode: 0x0e, mnemonic: 'JNZ', operand: true, description: 'Jump if the stored zero flag is zero.' },
  { opcode: 0x0f, mnemonic: 'JC', operand: true, description: 'Jump if the stored carry flag is one.' },
  { opcode: 0x10, mnemonic: 'OUT', operand: false, description: 'Latch A in the output register.' },
  { opcode: 0x11, mnemonic: 'IN', operand: false, description: 'Sample the external input into A.' },
  { opcode: 0xff, mnemonic: 'HLT', operand: false, description: 'Halt with PC held on this instruction.' },
] as const;

export type Mnemonic = (typeof INSTRUCTION_SET)[number]['mnemonic'];
export type InstructionSpec = (typeof INSTRUCTION_SET)[number];

export const INSTRUCTIONS_BY_NAME: ReadonlyMap<string, InstructionSpec> = new Map(
  INSTRUCTION_SET.map((instruction) => [instruction.mnemonic, instruction]),
);
export const INSTRUCTIONS_BY_OPCODE: ReadonlyMap<number, InstructionSpec> = new Map(
  INSTRUCTION_SET.map((instruction) => [instruction.opcode, instruction]),
);

export const ALU_OPERATIONS = [
  'Immediate', 'RAM', 'Add', 'Subtract', 'AND', 'OR', 'XOR', 'NOT', 'Shift left', 'Shift right', 'Input',
] as const;

export function disassemble(word: number): string {
  const instruction = INSTRUCTIONS_BY_OPCODE.get((word >>> 8) & 0xff);
  if (!instruction) return `.WORD 0x${(word & 0xffff).toString(16).padStart(4, '0').toUpperCase()}`;
  return instruction.operand
    ? `${instruction.mnemonic} ${(word & 0xff).toString()}`
    : instruction.mnemonic;
}
