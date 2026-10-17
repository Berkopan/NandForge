import { describe, expect, it } from 'vitest';
import { CircuitError, compileCircuit, createComponent, validateCircuit } from '../../src/core';
import type { Circuit } from '../../src/core';
import { componentCircuit } from './helpers';

const codes = (circuit: Circuit) => validateCircuit(circuit).map(diagnostic => diagnostic.code);

describe('circuit graph validation', () => {
  it('reports missing required inputs with precise component and pin information', () => {
    const circuit = componentCircuit('NAND');
    circuit.connections = circuit.connections.filter(wire => wire.id !== 'in-b');
    expect(validateCircuit(circuit)).toContainEqual(expect.objectContaining({ code: 'MISSING_INPUT', nodeId: 'gate', pin: 'b', severity: 'error' }));
    try { compileCircuit(circuit); throw new Error('Expected compilation error'); }
    catch (error) { expect(error).toBeInstanceOf(CircuitError); expect((error as CircuitError).diagnostics[0]?.code).toBe('MISSING_INPUT'); }
  });

  it('rejects width mismatches instead of silently truncating connected buses', () => {
    const circuit = componentCircuit('NAND');
    circuit.components.find(node => node.id === 'a')!.config.width = 8;
    expect(codes(circuit)).toContain('WIDTH_MISMATCH');
  });

  it('rejects multiple drivers while permitting output fan-out', () => {
    const circuit = componentCircuit('NAND');
    circuit.connections.push({ id: 'duplicate-drive', from: { node: 'a', pin: 'out' }, to: { node: 'gate', pin: 'b' } });
    expect(codes(circuit)).toContain('MULTIPLE_DRIVERS');
    circuit.connections = circuit.connections.filter(wire => wire.id !== 'in-b');
    expect(validateCircuit(circuit)).toEqual([]);
  });

  it('rejects invalid pin directions and references to removed components', () => {
    const circuit = componentCircuit('NAND');
    circuit.connections[0]!.from.pin = 'in';
    expect(codes(circuit)).toContain('INVALID_PIN');
    circuit.connections[0]!.from.node = 'deleted';
    expect(codes(circuit)).toContain('MISSING_NODE');
  });

  it('detects NAND-derived combinational feedback and distinguishes sequential feedback', () => {
    const circuit = componentCircuit('NOT');
    circuit.connections.find(wire => wire.id === 'in-in')!.from = { node: 'gate', pin: 'out' };
    expect(codes(circuit)).toContain('COMBINATIONAL_LOOP');
    const state = componentCircuit('DFF');
    state.connections.find(wire => wire.id === 'in-d')!.from = { node: 'gate', pin: 'q' };
    expect(validateCircuit(state)).toEqual([]);
  });

  it('treats asynchronous memory reads as combinational dependencies', () => {
    const circuit = componentCircuit('RAM', { width: 1, addressWidth: 1 });
    circuit.connections.find(wire => wire.id === 'in-addr')!.from = { node: 'gate', pin: 'out' };
    expect(codes(circuit)).toContain('COMBINATIONAL_LOOP');
  });

  it('supports explicitly optional carry inputs with a documented zero constant', async () => {
    const { Simulator } = await import('../../src/core');
    const circuit = componentCircuit('ADDER', { width: 8 });
    circuit.components = circuit.components.filter(node => node.id !== 'cin');
    circuit.connections = circuit.connections.filter(wire => wire.id !== 'in-cin');
    const simulator = new Simulator(compileCircuit(circuit));
    simulator.setInputs({ a: 255, b: 1 });
    expect(simulator.read('gate', 'sum')).toBe(0);
    expect(simulator.read('gate', 'cout')).toBe(1);
  });

  it('rejects invalid bus widths, memory addresses, initial words, and duplicate identities', () => {
    for (const width of [0, 17, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const circuit = componentCircuit('NAND');
      circuit.components[0]!.config.width = width;
      expect(codes(circuit)).toContain('INVALID_WIDTH');
    }
    const memory = componentCircuit('ROM', { width: 8 });
    memory.components[0]!.config.addressWidth = 17;
    expect(codes(memory)).toContain('INVALID_WIDTH');
    memory.components[0]!.config.addressWidth = 8;
    memory.components[0]!.config.contents = [256];
    expect(codes(memory)).toContain('INVALID_CONFIG');
    const duplicate = componentCircuit('NAND');
    duplicate.components.push({ ...duplicate.components[0]! });
    expect(codes(duplicate)).toContain('DUPLICATE_ID');
  });

  it('bounds declared graph sizes and total memory capacity before allocating runtime storage', () => {
    const circuit: Circuit = { id: 'too-large', name: 'Too large', version: 1, components: new Array(25_001).fill(createComponent('CONST', 'a')), connections: [] };
    expect(codes(circuit)).toEqual(['LIMIT_EXCEEDED']);
    const memory: Circuit = { id: 'memory-bomb', name: 'Memory bomb', version: 1, components: [], connections: [] };
    memory.components.push(createComponent('CONST', 'address', undefined, { width: 16 }));
    for (let index = 0; index < 17; index++) {
      memory.components.push(createComponent('ROM', `rom-${index}`, undefined, { width: 16, addressWidth: 16 }));
      memory.connections.push({ id: `addr-${index}`, from: { node: 'address', pin: 'out' }, to: { node: `rom-${index}`, pin: 'addr' } });
    }
    expect(codes(memory)).toContain('LIMIT_EXCEEDED');
  });
});
