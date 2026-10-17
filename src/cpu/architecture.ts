import type { ChipDefinition, Circuit, Endpoint } from '../core/types';
import { buildAluChip } from './alu';
import { CircuitBuilder } from './builder';
import { INSTRUCTION_SET } from './isa';

export const CPU_SUBSYSTEMS = [
  { nodeId: 'decoder', name: 'Instruction Decoder', nameTr: 'Komut Çözücü', description: 'ROM bits become an operand and one-hot instruction select lines.' },
  { nodeId: 'control', name: 'Control Unit', nameTr: 'Kontrol Birimi', description: 'Registered flags and decoded instructions determine actual write enables and branch selection.' },
  { nodeId: 'alu', name: 'Arithmetic / Logic Unit', nameTr: 'Aritmetik / Mantık Birimi', description: 'Ripple-carry addition, subtraction, bitwise logic, shifts and result multiplexing.' },
  { nodeId: 'registers', name: 'Register Bank', nameTr: 'Yazmaç Kümesi', description: 'Accumulator, flags, HALT and fault latches sample the same rising edge.' },
  { nodeId: 'pc', name: 'Program Counter', nameTr: 'Program Sayacı', description: 'An 8-bit incrementer and branch multiplexer feed the enabled PC register.' },
  { nodeId: 'flags', name: 'Flag Logic', nameTr: 'Bayrak Mantığı', description: 'A reduction tree detects an all-zero result; ALU carry is routed to the C latch.' },
  { nodeId: 'ram', name: 'Data RAM · 256 × 8', nameTr: 'Veri RAM · 256 × 8', description: 'Asynchronous read, atomic rising-edge write, one byte per address.' },
  { nodeId: 'rom', name: 'Instruction ROM · 256 × 16', nameTr: 'Komut ROM · 256 × 16', description: 'PC addresses fixed-length words: opcode in bits 15–8, operand in bits 7–0.' },
  { nodeId: 'io', name: 'Input / Output', nameTr: 'Giriş / Çıkış', description: 'An externally held input byte and a clocked output register.' },
] as const;

export function buildDecoderChip(): ChipDefinition {
  const b = new CircuitBuilder('cpu-decoder', 'Instruction Decoder');
  const bits = b.split(b.input('instruction', 16), 16, 'instruction-bits');
  const opcode = bits.slice(8);
  const complement = opcode.map((bit, i) => b.unary('NOT', bit, 1, `opcode-not-${i}`));
  const select = INSTRUCTION_SET.map((instruction) => b.reduce('AND',
    opcode.map((bit, i) => ((instruction.opcode >>> i) & 1) ? bit : complement[i]!),
    `decode-${instruction.mnemonic.toLowerCase()}`,
  ));
  b.output('opcode', b.join(opcode, 'opcode-byte'), 8);
  b.output('operand', b.join(bits.slice(0, 8), 'operand-byte'), 8);
  b.output('decodedLow', b.join(select.slice(0, 16), 'decoded-low'), 16);
  b.output('decodedHigh', b.join(select.slice(16), 'decoded-high'), 3);
  b.output('valid', b.reduce('OR', select, 'valid-instruction'));
  return b.definition('Nineteen 8-bit minterms made from shared inversions and balanced AND trees. No lookup interpreter executes instructions: these gate outputs drive the control unit. decodedLow bits correspond to opcodes 00–0F; decodedHigh bits 0, 1 and 2 correspond to OUT, IN and HLT.');
}

export function buildControlChip(): ChipDefinition {
  const b = new CircuitBuilder('cpu-control', 'Control Unit');
  const low = b.split(b.input('decodedLow', 16), 16, 'decode-low-bits');
  const high = b.split(b.input('decodedHigh', 3), 3, 'decode-high-bits');
  const valid = b.input('valid');
  const z = b.input('z');
  const c = b.input('c');
  const halted = b.input('halted');
  const fault = b.input('fault');
  const active = b.unary('NOT', b.binary('OR', halted, fault), 1, 'processor-active');
  const permitted = b.binary('AND', valid, active, 1, 'valid-and-active');
  const invalid = b.unary('NOT', valid, 1, 'invalid-opcode');
  const halt = high[2]!;
  const aInstructions = [low[1]!, low[2]!, ...low.slice(4, 12), high[1]!];
  const aWrite = b.binary('AND', permitted, b.reduce('OR', aInstructions, 'writes-a'), 1, 'a-write-enable');
  const cWrite = b.binary('AND', permitted, b.reduce('OR', [low[4]!, low[5]!, low[10]!, low[11]!], 'writes-c'), 1, 'c-write-enable');
  const branches = [
    low[12]!,
    b.binary('AND', low[13]!, z, 1, 'branch-z'),
    b.binary('AND', low[14]!, b.unary('NOT', z), 1, 'branch-nz'),
    b.binary('AND', low[15]!, c, 1, 'branch-c'),
  ];
  const branch = b.binary('AND', permitted, b.reduce('OR', branches, 'branch-condition'), 1, 'branch-taken');

  // This table is elaborated into OR gates once. At runtime only their netlist is evaluated.
  const aluSelections: [Endpoint, number][] = [
    [low[1]!, 0], [low[2]!, 1], [low[4]!, 2], [low[5]!, 3], [low[6]!, 4],
    [low[7]!, 5], [low[8]!, 6], [low[9]!, 7], [low[10]!, 8], [low[11]!, 9], [high[1]!, 10],
  ];
  const operation = Array.from({ length: 4 }, (_, bit) => b.reduce('OR',
    aluSelections.filter(([, encoding]) => (encoding >>> bit) & 1).map(([line]) => line),
    `alu-operation-bit-${bit}`,
  ));

  b.output('active', active);
  b.output('aWrite', aWrite);
  b.output('zWrite', aWrite);
  b.output('cWrite', cWrite);
  b.output('ramWrite', b.binary('AND', permitted, low[3]!, 1, 'ram-write-enable'));
  b.output('outWrite', b.binary('AND', permitted, high[0]!, 1, 'out-write-enable'));
  b.output('pcWrite', b.binary('AND', permitted, b.unary('NOT', halt), 1, 'pc-write-enable'));
  b.output('branch', branch);
  b.output('haltWrite', b.binary('AND', active, b.binary('OR', halt, invalid), 1, 'halt-write-enable'));
  b.output('faultWrite', b.binary('AND', active, invalid, 1, 'fault-write-enable'));
  b.output('aluOp', b.join(operation, 'operation-bus'), 4);
  return b.definition('Boolean control equations select ALU operations and generate every write enable. Conditional branches use the previously registered Z/C flags. HLT and invalid opcodes inhibit PC advancement; invalid opcodes latch both HALT and FAULT without other side effects.');
}

export function buildRegisterBankChip(): ChipDefinition {
  const b = new CircuitBuilder('cpu-registers', 'Register Bank');
  const clk = b.input('clk');
  const aNext = b.input('aNext', 8);
  const aWrite = b.input('aWrite');
  const zNext = b.input('zNext');
  const zWrite = b.input('zWrite');
  const cNext = b.input('cNext');
  const cWrite = b.input('cWrite');
  const haltWrite = b.input('haltWrite');
  const faultWrite = b.input('faultWrite');
  const one = b.constant(1);
  b.output('a', b.register('accumulator', aNext, clk, aWrite, 8), 8);
  b.output('z', b.register('zero-flag', zNext, clk, zWrite, 1, 1));
  b.output('c', b.register('carry-flag', cNext, clk, cWrite, 1));
  b.output('halted', b.register('halt-latch', one, clk, haltWrite, 1));
  b.output('fault', b.register('fault-latch', one, clk, faultWrite, 1));
  return b.definition('Each enabled register expands into a feedback MUX and ideal D flip-flops. A resets to 0; Z resets to 1 to reflect that value; C, HALT and FAULT reset to 0. All next states are sampled atomically.');
}

export function buildProgramCounterChip(): ChipDefinition {
  const b = new CircuitBuilder('cpu-pc', 'Program Counter');
  const target = b.input('target', 8);
  const branch = b.input('branch');
  const write = b.input('write');
  const clk = b.input('clk');
  const current = b.ref('pc-register', 'q');
  const increment = b.adder(current, b.constant(1, 8), b.constant(0), 8, 'pc-incrementer');
  const next = b.mux(increment.sum, target, branch, 8, 'pc-source');
  b.output('pc', b.register('pc-register', next, clk, write, 8), 8);
  b.output('next', next, 8);
  return b.definition('A ripple-carry incrementer wraps modulo 256. A branch multiplexer selects the operand address. The register holds its address while halted or faulted.');
}

export function buildFlagLogicChip(): ChipDefinition {
  const b = new CircuitBuilder('cpu-flags', 'Flag Logic');
  const result = b.split(b.input('result', 8), 8, 'result-bits');
  const carry = b.input('carry');
  b.output('zero', b.unary('NOT', b.reduce('OR', result, 'nonzero'), 1, 'zero-detect'));
  b.output('carryOut', b.unary('BUFFER', carry, 1, 'carry-route'));
  return b.definition('A balanced OR reduction followed by inversion computes result == 0. The control unit separately decides when the Z and C registers may change.');
}

export function buildIoChip(): ChipDefinition {
  const b = new CircuitBuilder('cpu-io', 'Input / Output');
  const external = b.input('external', 8);
  const a = b.input('a', 8);
  const write = b.input('write');
  const clk = b.input('clk');
  b.output('input', b.unary('BUFFER', external, 8, 'input-bus'), 8);
  b.output('output', b.register('output-register', a, clk, write, 8), 8);
  return b.definition('The external input byte is held by the user-controlled INPUT source and sampled by IN at the CPU edge. OUT enables an eight-DFF output register, which remains latched until another OUT or Reset.');
}

export function buildCpuCircuit(): { circuit: Circuit; chips: ChipDefinition[] } {
  const decoder = buildDecoderChip();
  const control = buildControlChip();
  const alu = buildAluChip();
  const registers = buildRegisterBankChip();
  const pc = buildProgramCounterChip();
  const flags = buildFlagLogicChip();
  const io = buildIoChip();
  const chips = [decoder, control, alu, registers, pc, flags, io];
  const b = new CircuitBuilder('nandforge-cpu', 'NandForge 8-bit Computer', 'Every architectural step is one common simulator clock edge through this hierarchical circuit.');
  const clk = b.ref(b.component('CLOCK', 'clock', {}, 'CPU Clock'));
  const external = b.input('external-input', 8);
  b.component('ROM', 'rom', { width: 16, addressWidth: 8, contents: Array<number>(256).fill(0) }, 'Instruction ROM');
  b.component('RAM', 'ram', { width: 8, addressWidth: 8, contents: Array<number>(256).fill(0) }, 'Data RAM');

  b.chip('decoder', decoder, { instruction: b.ref('rom') });
  b.chip('control', control, {
    decodedLow: b.ref('decoder', 'decodedLow'), decodedHigh: b.ref('decoder', 'decodedHigh'),
    valid: b.ref('decoder', 'valid'), z: b.ref('registers', 'z'), c: b.ref('registers', 'c'),
    halted: b.ref('registers', 'halted'), fault: b.ref('registers', 'fault'),
  });
  b.chip('alu', alu, {
    a: b.ref('registers', 'a'), b: b.ref('ram'), immediate: b.ref('decoder', 'operand'),
    external: b.ref('io', 'input'), operation: b.ref('control', 'aluOp'),
  });
  b.chip('flags', flags, { result: b.ref('alu', 'result'), carry: b.ref('alu', 'carry') });
  b.chip('registers', registers, {
    clk, aNext: b.ref('alu', 'result'), aWrite: b.ref('control', 'aWrite'),
    zNext: b.ref('flags', 'zero'), zWrite: b.ref('control', 'zWrite'),
    cNext: b.ref('flags', 'carryOut'), cWrite: b.ref('control', 'cWrite'),
    haltWrite: b.ref('control', 'haltWrite'), faultWrite: b.ref('control', 'faultWrite'),
  });
  b.chip('pc', pc, { target: b.ref('decoder', 'operand'), branch: b.ref('control', 'branch'), write: b.ref('control', 'pcWrite'), clk });
  b.chip('io', io, { external, a: b.ref('registers', 'a'), write: b.ref('control', 'outWrite'), clk });
  b.wire(b.ref('pc', 'pc'), 'rom', 'addr');
  b.wire(b.ref('decoder', 'operand'), 'ram', 'addr');
  b.wire(b.ref('registers', 'a'), 'ram', 'd');
  b.wire(b.ref('control', 'ramWrite'), 'ram', 'we');
  b.wire(clk, 'ram', 'clk');

  const observations: [string, Endpoint, number][] = [
    ['A', b.ref('registers', 'a'), 8], ['PC', b.ref('pc', 'pc'), 8],
    ['Z', b.ref('registers', 'z'), 1], ['C', b.ref('registers', 'c'), 1],
    ['OUT', b.ref('io', 'output'), 8], ['IN', b.ref('io', 'input'), 8],
    ['HALTED', b.ref('registers', 'halted'), 1], ['FAULT', b.ref('registers', 'fault'), 1],
    ['OPCODE', b.ref('decoder', 'opcode'), 8], ['OPERAND', b.ref('decoder', 'operand'), 8],
    ['ALU_RESULT', b.ref('alu', 'result'), 8], ['ALU_CARRY', b.ref('alu', 'carry'), 1],
  ];
  observations.forEach(([name, source, width]) => b.output(name, source, width));
  const positions: Record<string, { x: number; y: number }> = {
    clock: { x: -400, y: 660 }, 'external-input': { x: -400, y: 920 },
    pc: { x: -130, y: 0 }, rom: { x: 170, y: 0 }, decoder: { x: 450, y: 0 },
    control: { x: 800, y: 0 }, registers: { x: 1160, y: 0 },
    ram: { x: 170, y: 550 }, alu: { x: 450, y: 550 }, flags: { x: 800, y: 800 },
    io: { x: -130, y: 750 },
  };
  b.circuit.components.forEach((component) => {
    const position = positions[component.id];
    if (position) component.position = position;
    else if (component.type === 'OUTPUT') {
      const index = observations.findIndex(([name]) => name === component.id);
      component.position = { x: 1510 + (index % 2) * 230, y: Math.floor(index / 2) * 180 };
    }
  });
  return { circuit: b.circuit, chips };
}
