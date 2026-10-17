import { describe, expect, it } from 'vitest';
import { assemble, EXAMPLE_PROGRAMS } from '../../src/assembler';
import { CpuMachine, buildCpuCircuit, INSTRUCTION_SET } from '../../src/cpu';
import type { CpuState } from '../../src/cpu';
import { compileCircuit, validateCircuit } from '../../src/core';
import { ReferenceMachine } from './reference';

function word(opcode: number, operand = 0): number { return opcode * 256 + operand; }
const architectural = ['a', 'pc', 'z', 'c', 'output', 'input', 'halted', 'fault', 'cycles'] as const;

function compare(actual: CpuState, reference: ReferenceMachine, context: string): void {
  for (const key of architectural) {
    if (actual[key] !== reference[key]) throw new Error(`${context}: ${key} circuit=${actual[key]} reference=${reference[key]}`);
  }
  for (let i = 0; i < 256; i += 1) {
    if (actual.ram[i] !== reference.ram[i]) throw new Error(`${context}: RAM[${i}] circuit=${actual.ram[i]} reference=${reference.ram[i]}`);
  }
}

function runSource(source: string, maxCycles = 2000): CpuMachine {
  const program = assemble(source);
  expect(program.diagnostics).toEqual([]);
  const machine = new CpuMachine();
  machine.load(program.rom);
  for (let i = 0; i < maxCycles && !machine.state.halted; i += 1) machine.step();
  expect(machine.state.halted).toBe(true);
  expect(machine.state.fault).toBe(false);
  return machine;
}

describe('genuine circuit CPU', () => {
  it('compiles the hierarchical datapath with real sequential state and NAND gates', () => {
    const { circuit, chips } = buildCpuCircuit();
    expect(chips.map(({ id }) => id)).toEqual(expect.arrayContaining(['cpu-alu', 'cpu-control', 'cpu-decoder', 'cpu-registers', 'cpu-pc', 'cpu-flags', 'cpu-io']));
    expect(validateCircuit(circuit, chips).filter(({ severity }) => severity === 'error')).toEqual([]);
    const compiled = compileCircuit(circuit, chips);
    expect(compiled.stats.gates).toBeGreaterThan(500);
    expect(compiled.stats.sequential).toBeGreaterThanOrEqual(5);
  });

  it.each(EXAMPLE_PROGRAMS)('executes the $name program on the gate circuit', (example) => {
    const program = assemble(example.source);
    expect(program.ok).toBe(true);
    const machine = new CpuMachine();
    machine.load(program.rom);
    machine.setInput(example.input ?? 0);
    const oracle = new ReferenceMachine(program.rom);
    oracle.input = example.input ?? 0;
    const observedOutputs: number[] = [];
    for (let cycle = 0; cycle < 2000 && !machine.state.halted; cycle += 1) {
      const emitting = machine.state.control.outWrite === 1;
      oracle.step();
      const actual = machine.step();
      compare(actual, oracle, `${example.id} cycle ${cycle}`);
      if (emitting) observedOutputs.push(actual.output);
    }
    expect(machine.state.fault).toBe(false);
    expect(machine.state.halted).toBe(true);
    expect(machine.state.output).toBe(example.expectedOutput);
    expect(observedOutputs).toEqual(example.expectedOutputs);
  });

  it('decodes all 256 opcode bytes, faults precisely on every reserved value', () => {
    const valid = new Set<number>(INSTRUCTION_SET.map(({ opcode }) => opcode));
    const machine = new CpuMachine();
    const ram = Array.from({ length: 256 }, (_, i) => (i * 73 + 19) & 255);
    for (let opcode = 0; opcode < 256; opcode += 1) {
      const rom = [word(opcode, 255)];
      machine.load(rom, ram);
      machine.setInput(211);
      const oracle = new ReferenceMachine(rom, ram);
      oracle.input = 211;
      oracle.step();
      compare(machine.step(), oracle, `opcode 0x${opcode.toString(16)}`);
      expect(machine.state.fault).toBe(!valid.has(opcode));
    }
  });

  it('holds the HLT address and all state, including cycle count, on later steps', () => {
    const machine = runSource('LDI 73\nOUT\nHLT\nLDI 1\nOUT');
    const halted = machine.snapshot();
    expect(machine.state).toMatchObject({ pc: 2, output: 73, halted: true, cycles: 3 });
    for (let i = 0; i < 8; i += 1) machine.step();
    expect(machine.snapshot()).toEqual(halted);
  });

  it('preserves A, flags, memory and output while latching an invalid-instruction fault', () => {
    const machine = runSource('LDI 128\nSHL\nOUT\nHLT');
    machine.load([word(0x01, 128), word(0x0a), word(0x10), word(0x92, 0)]);
    machine.step(); machine.step(); machine.step();
    const before = machine.state;
    const after = machine.step();
    expect(after).toMatchObject({ pc: 3, a: before.a, z: before.z, c: before.c, output: before.output, halted: true, fault: true });
    expect(after.ram).toEqual(before.ram);
    expect(after.control).toMatchObject({ active: 0, aWrite: 0, ramWrite: 0, outWrite: 0, pcWrite: 0 });
  });

  it('wraps PC from address 255 to zero and can branch to both memory boundaries', () => {
    const machine = new CpuMachine();
    const program = assemble('JMP 255\n.ORG 255\nNOP');
    machine.load(program.rom);
    machine.step();
    expect(machine.state.pc).toBe(255);
    machine.step();
    expect(machine.state.pc).toBe(0);
    expect(machine.state.cycles).toBe(2);
  });

  it('uses stored flags for taken and untaken JZ/JNZ/JC branches', () => {
    const conditions = [
      { prefix: [word(1, 0)], z: 1, c: 0 },
      { prefix: [word(1, 7)], z: 0, c: 0 },
      { prefix: [word(1, 128), word(0x0a)], z: 1, c: 1 },
      { prefix: [word(1, 129), word(0x0a)], z: 0, c: 1 },
    ];
    for (const condition of conditions) {
      for (const opcode of [0x0d, 0x0e, 0x0f]) {
        const machine = new CpuMachine();
        machine.load([...condition.prefix, word(opcode, 200)]);
        condition.prefix.forEach(() => machine.step());
        expect(machine.state).toMatchObject({ z: condition.z, c: condition.c });
        const taken = opcode === 0x0d ? condition.z : opcode === 0x0e ? !condition.z : condition.c;
        expect(machine.state.control.branch).toBe(Number(taken));
        machine.step();
        expect(machine.state.pc).toBe(taken ? 200 : condition.prefix.length + 1);
      }
    }
  });

  it('updates Z for every instruction writing A and preserves C for all other operations', () => {
    const preservingOperations = [word(1, 0), word(2, 0), word(6, 0), word(7, 0), word(8, 0), word(9), word(0x11)];
    for (const operation of preservingOperations) {
      const machine = new CpuMachine();
      machine.load([word(1, 128), word(0x0a), operation]);
      machine.step(); machine.step();
      const next = machine.step();
      expect(next.c).toBe(1);
      expect(next.z).toBe(Number(next.a === 0));
    }
    const noAWrite = [word(0), word(3, 0), word(0x10), word(0x0c, 3), word(0x0d, 3), word(0x0e, 3), word(0x0f, 3), word(0xff)];
    for (const operation of noAWrite) {
      const machine = new CpuMachine();
      machine.load([word(1, 129), word(0x0a), operation]);
      machine.step(); machine.step();
      expect(machine.step()).toMatchObject({ a: 2, z: 0, c: 1 });
    }
  });

  it('handles ADD overflow, SUB unsigned no-borrow, and zero wraparound at boundaries', () => {
    for (const [a, b] of [[0, 0], [0, 1], [1, 0], [255, 1], [255, 255], [128, 128], [127, 128], [1, 255]]) {
      if (a === undefined || b === undefined) throw new Error('Invalid test vector');
      for (const opcode of [4, 5]) {
        const machine = new CpuMachine();
        machine.load([word(1, a), word(opcode, 255)], Array.from({ length: 256 }, (_, i) => i === 255 ? b : 0));
        machine.step();
        const result = machine.step();
        const expected = (opcode === 4 ? a + b : a - b) & 255;
        expect(result).toMatchObject({ a: expected, z: Number(expected === 0), c: opcode === 4 ? Number(a + b > 255) : Number(a >= b) });
      }
    }
  });

  it('samples input only on IN, keeps OUT latched, and writes RAM at a single edge', () => {
    const machine = new CpuMachine();
    machine.load([word(0x11), word(0x10), word(3, 255), word(1, 0), word(3, 0), word(0xff)]);
    machine.setInput(211);
    expect(machine.state).toMatchObject({ input: 211, a: 0, output: 0, cycles: 0 });
    machine.step();
    machine.setInput(17);
    expect(machine.state.a).toBe(211);
    machine.step();
    expect(machine.state.output).toBe(211);
    expect(machine.state.ram[255]).toBe(0);
    machine.step();
    expect(machine.state.ram[255]).toBe(211);
    machine.step(); machine.step();
    expect(machine.state).toMatchObject({ a: 0, output: 211, input: 17 });
    expect(machine.state.ram[0]).toBe(0);
  });

  it('restores serializable snapshots and replays exactly, including RAM and external input', () => {
    const machine = new CpuMachine();
    const program = assemble('IN\nSTA 255\nLDI 1\nADD 255\nOUT\nHLT');
    machine.load(program.rom);
    machine.setInput(37);
    machine.step(); machine.step();
    const snapshot = JSON.parse(JSON.stringify(machine.snapshot())) as ReturnType<CpuMachine['snapshot']>;
    const later: CpuState[] = [];
    for (let i = 0; i < 4; i += 1) later.push(machine.step());
    machine.restore(snapshot);
    for (const expected of later) expect(machine.step()).toEqual(expected);
    machine.reset();
    expect(machine.state).toMatchObject({ a: 0, pc: 0, z: 1, c: 0, output: 0, input: 0, halted: false, fault: false, cycles: 0 });
    expect(machine.state.ram.every((value) => value === 0)).toBe(true);
    expect(machine.state.opcode).toBe(0x11);
  });

  it('restores the loaded program and reset RAM when a snapshot crosses program loads', () => {
    const machine = new CpuMachine();
    machine.load([word(1, 93), word(0xff)], [7]);
    const snapshot = machine.snapshot();
    machine.load([word(1, 2), word(0xff)], [88]);
    machine.restore(snapshot);
    machine.reset();
    expect(machine.state.ram[0]).toBe(7);
    expect(machine.step().a).toBe(93);
  });

  it('records real rising and falling clock phases', () => {
    const machine = new CpuMachine();
    machine.load([word(1, 42), word(0xff)]);
    const phases: { phase: string; clock: number; a: number }[] = [];
    machine.step((phase) => phases.push({ phase, clock: machine.simulator.read('clock', 'out'), a: machine.state.a }));
    expect(phases.map(({ phase, clock }) => [phase, clock])).toEqual([['rising', 1], ['falling', 0]]);
    expect(phases.every(({ a }) => a === 42)).toBe(true);
  });

  it('validates load/input ranges before mutating the running machine', () => {
    const machine = new CpuMachine();
    machine.load([word(1, 8)]);
    machine.step();
    const before = machine.snapshot();
    expect(() => machine.load([65536])).toThrow(RangeError);
    expect(() => machine.load([0], [256])).toThrow(RangeError);
    expect(() => machine.load(Array<number>(257).fill(0))).toThrow(RangeError);
    expect(() => machine.setInput(-1)).toThrow(RangeError);
    expect(() => machine.setInput(2.5)).toThrow(RangeError);
    expect(machine.snapshot()).toEqual(before);
  });

  it('matches an independent reference interpreter over deterministic randomized instruction streams', () => {
    let seed = 0x42c0ffee;
    function random(): number {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return seed >>> 0;
    }
    const operations = [0, 1, 1, 2, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
    const machine = new CpuMachine();
    let executed = 0;
    for (let program = 0; program < 96; program += 1) {
      const ram = Array.from({ length: 256 }, () => random() & 255);
      const rom = Array.from({ length: 256 }, (_, pc) => {
        if (pc >= 80) return word(pc === 255 ? 0xff : 0);
        const opcode = operations[random() % operations.length]!;
        const operand = opcode >= 12 && opcode <= 15 ? random() % 80 : random() & 255;
        return word(opcode, operand);
      });
      rom[0] = word(1, random() & 255);
      machine.load(rom, ram);
      const oracle = new ReferenceMachine(rom, ram);
      for (let cycle = 0; cycle < 128; cycle += 1) {
        const external = random() & 255;
        oracle.input = external;
        machine.setInput(external);
        oracle.step();
        compare(machine.step(), oracle, `seeded program ${program} cycle ${cycle}`);
        executed += 1;
      }
    }
    expect(executed).toBe(12288);
  }, 120_000);
});
