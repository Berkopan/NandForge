import { compileCircuit, Simulator } from '../core';
import type { Circuit, ChipDefinition } from '../core/types';
import { buildCpuCircuit } from './architecture';

export interface CpuControlSignals {
  active: number;
  aWrite: number;
  zWrite: number;
  cWrite: number;
  ramWrite: number;
  outWrite: number;
  pcWrite: number;
  branch: number;
  haltWrite: number;
  faultWrite: number;
  aluOp: number;
}

export interface CpuState {
  a: number;
  pc: number;
  z: number;
  c: number;
  output: number;
  input: number;
  halted: boolean;
  fault: boolean;
  cycles: number;
  ram: number[];
  opcode: number;
  operand: number;
  instruction: number;
  aluResult: number;
  aluCarry: number;
  aluOperation: number;
  nextPc: number;
  control: CpuControlSignals;
}

export interface CpuSnapshot {
  version: 1;
  core: ReturnType<Simulator['snapshot']>;
  rom: number[];
  initialRam: number[];
}

let cached: { circuit: Circuit; chips: ChipDefinition[]; compiled: ReturnType<typeof compileCircuit> } | undefined;

function architecture(): NonNullable<typeof cached> {
  if (!cached) {
    const { circuit, chips } = buildCpuCircuit();
    cached = { circuit, chips, compiled: compileCircuit(circuit, chips) };
  }
  return cached;
}

function image(contents: readonly number[], max: number, name: string): number[] {
  if (contents.length > 256) throw new RangeError(`${name} can contain at most 256 words.`);
  const result = Array<number>(256).fill(0);
  contents.forEach((value, index) => {
    if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${name}[${index}] must be an integer between 0 and ${max}.`);
    result[index] = value;
  });
  return result;
}

/**
 * Runtime adapter around the common circuit simulator.
 * No opcode dispatch, arithmetic execution, RAM instruction handlers, or shadow CPU state live here.
 */
export class CpuMachine {
  readonly simulator: Simulator;
  readonly circuit: Circuit;
  readonly chips: ChipDefinition[];
  private rom = Array<number>(256).fill(0);
  private initialRam = Array<number>(256).fill(0);

  constructor() {
    const built = architecture();
    this.circuit = built.circuit;
    this.chips = built.chips;
    this.simulator = new Simulator(built.compiled);
    this.simulator.evaluate();
  }

  load(rom: readonly number[], ram: readonly number[] = []): void {
    // Validate both images before changing any state.
    const nextRom = image(rom, 65535, 'ROM');
    const nextRam = image(ram, 255, 'RAM');
    this.rom = nextRom;
    this.initialRam = nextRam;
    this.reset();
  }

  reset(): void {
    this.simulator.reset();
    this.simulator.setMemory('rom', this.rom);
    this.simulator.setMemory('ram', this.initialRam);
    this.simulator.setInput('external-input', 0);
    this.simulator.evaluate();
  }

  setInput(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('Input must be an integer between 0 and 255.');
    this.simulator.setInput('external-input', value);
  }

  step(observer?: (phase: 'rising' | 'falling') => void): CpuState {
    // Clock-enable behavior only: the halt/fault decisions themselves are circuit outputs.
    if (!this.simulator.read('registers', 'halted') && !this.simulator.read('registers', 'fault')) {
      this.simulator.step(observer);
    }
    return this.state;
  }

  get state(): CpuState {
    const read = (node: string, pin: string): number => this.simulator.read(node, pin);
    const control: CpuControlSignals = {
      active: read('control', 'active'), aWrite: read('control', 'aWrite'), zWrite: read('control', 'zWrite'),
      cWrite: read('control', 'cWrite'), ramWrite: read('control', 'ramWrite'), outWrite: read('control', 'outWrite'),
      pcWrite: read('control', 'pcWrite'), branch: read('control', 'branch'), haltWrite: read('control', 'haltWrite'),
      faultWrite: read('control', 'faultWrite'), aluOp: read('control', 'aluOp'),
    };
    return {
      a: read('registers', 'a'), pc: read('pc', 'pc'), z: read('registers', 'z'), c: read('registers', 'c'),
      output: read('io', 'output'), input: read('io', 'input'),
      halted: Boolean(read('registers', 'halted')), fault: Boolean(read('registers', 'fault')),
      cycles: this.simulator.cycle, ram: this.simulator.getMemory('ram'),
      opcode: read('decoder', 'opcode'), operand: read('decoder', 'operand'), instruction: read('rom', 'out'),
      aluResult: read('alu', 'result'), aluCarry: read('alu', 'carry'), aluOperation: control.aluOp,
      nextPc: read('pc', 'next'), control,
    };
  }

  snapshot(): CpuSnapshot {
    return { version: 1, core: this.simulator.snapshot(), rom: [...this.rom], initialRam: [...this.initialRam] };
  }

  restore(snapshot: CpuSnapshot): void {
    if (snapshot.version !== 1) throw new Error('Unsupported CPU snapshot version.');
    const rom = image(snapshot.rom, 65535, 'ROM');
    const ram = image(snapshot.initialRam, 255, 'RAM');
    this.simulator.restore(snapshot.core);
    this.rom = rom;
    this.initialRam = ram;
  }
}
