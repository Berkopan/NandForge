import { describe, expect, it } from 'vitest';
import { compileCircuit, createComponent, formatSignal, getChipForComponent, maskForWidth, Simulator } from '../../src/core';
import type { ComponentType } from '../../src/core';
import { componentCircuit, componentSimulator, rng } from './helpers';

describe('NAND-derived combinational logic', () => {
  const binary: [ComponentType, (a: number, b: number) => number][] = [
    ['NAND', (a, b) => ~(a & b)], ['AND', (a, b) => a & b], ['OR', (a, b) => a | b],
    ['NOR', (a, b) => ~(a | b)], ['XOR', (a, b) => a ^ b], ['XNOR', (a, b) => ~(a ^ b)],
  ];
  for (const [type, oracle] of binary) it(`${type} exhaustively implements all 4-bit vectors and broad 16-bit vectors`, () => {
    const small = componentSimulator(type, { width: 4 });
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) {
      small.setInputs({ a, b });
      expect(small.read('gate', 'out')).toBe(oracle(a, b) & 15);
    }
    const large = componentSimulator(type, { width: 16 });
    const random = rng();
    for (let index = 0; index < 512; index++) {
      const a = random() & 65535;
      const b = random() & 65535;
      large.setInputs({ a, b });
      expect(large.read('gate', 'out')).toBe(oracle(a, b) & 65535);
    }
    expect(large.compiled.operations.every(operation => ['NAND', 'SPLIT', 'JOIN'].includes(operation.kind))).toBe(true);
  });

  for (const type of ['NOT', 'BUFFER'] as const) it(`${type} handles every supported width`, () => {
    for (let width = 1; width <= 16; width++) {
      const simulator = componentSimulator(type, { width });
      for (const input of [0, 1, maskForWidth(width), maskForWidth(width) >>> 1]) {
        simulator.setInput('in', input);
        expect(simulator.read('gate', 'out')).toBe(type === 'NOT' ? (~input & maskForWidth(width)) : input);
      }
    }
  });

  it('exposes a detached, inspectable four-NAND XOR implementation and derived complexity', () => {
    const component = createComponent('XOR', 'x', undefined, { width: 8 });
    const implementation = getChipForComponent(component)!;
    expect(implementation.circuit.components.filter(node => node.type === 'NAND')).toHaveLength(4);
    implementation.circuit.components.length = 0;
    expect(getChipForComponent(component)!.circuit.components.length).toBeGreaterThan(4);
    const compiled = compileCircuit(componentCircuit('XOR', { width: 8 }));
    expect(compiled.stats.gates).toBe(32);
    expect(compiled.stats.depth).toBe(3);
    expect(compiled.stats.sequential).toBe(0);
  });

  it('multiplexes and demultiplexes complete four-bit spaces', () => {
    const mux = componentSimulator('MUX', { width: 4 });
    const demux = componentSimulator('DEMUX', { width: 4 });
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (let sel = 0; sel <= 1; sel++) {
      mux.setInputs({ a, b, sel });
      expect(mux.read('gate', 'out')).toBe(sel ? b : a);
    }
    for (let input = 0; input < 16; input++) for (let sel = 0; sel <= 1; sel++) {
      demux.setInputs({ in: input, sel });
      expect(demux.read('gate', 'a')).toBe(sel ? 0 : input);
      expect(demux.read('gate', 'b')).toBe(sel ? input : 0);
    }
  });

  it('decodes every 1–5 bit address to exactly one output', () => {
    for (let width = 1; width <= 5; width++) {
      const simulator = componentSimulator('DECODER', { width });
      for (let address = 0; address < 2 ** width; address++) {
        simulator.setInput('in', address);
        for (let pin = 0; pin < 2 ** width; pin++) expect(simulator.read('gate', `o${pin}`)).toBe(Number(pin === address));
      }
    }
  });

  it('split/join uses b0 as the least significant bit without arithmetic gate shortcuts', () => {
    const circuit = componentCircuit('SPLIT', { width: 16 });
    circuit.components.push(createComponent('JOIN', 'join', undefined, { width: 16 }));
    for (let bit = 0; bit < 16; bit++) circuit.connections.push({ id: `join-${bit}`, from: { node: 'gate', pin: `b${bit}` }, to: { node: 'join', pin: `b${bit}` } });
    const simulator = new Simulator(compileCircuit(circuit));
    for (const input of [0, 1, 2, 165, 0x8000, 0xa55a, 65535]) {
      simulator.setInput('in', input);
      for (let bit = 0; bit < 16; bit++) expect(simulator.read('gate', `b${bit}`)).toBe((input >>> bit) & 1);
      expect(simulator.read('join', 'out')).toBe(input);
    }
    expect(simulator.compiled.stats.gates).toBe(0);
  });

  it('normalizes safe integer inputs modulo bus width and rejects non-integers transactionally', () => {
    const simulator = componentSimulator('AND', { width: 8 });
    simulator.setInputs({ a: -1, b: 0x1ff });
    expect(simulator.read('gate', 'out')).toBe(255);
    const snapshot = simulator.snapshot();
    expect(() => simulator.setInputs({ a: 1, b: Number.NaN })).toThrow();
    expect(simulator.snapshot()).toEqual(snapshot);
    expect(() => simulator.setInput('missing', 1)).toThrow();
    expect(() => simulator.read('gate', 'missing')).toThrow();
    expect(formatSignal(165, 8, 2)).toBe('10100101');
    expect(formatSignal(10, 16, 16)).toBe('000A');
    expect(formatSignal(255, 8, 10)).toBe('255');
  });
});
