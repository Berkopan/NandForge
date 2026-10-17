import { describe, expect, it } from 'vitest';
import { CircuitBuilder, compileCircuit, createComponent, getChipForComponent, Simulator, validateCircuit } from '../../src/core';
import type { ChipDefinition, Circuit } from '../../src/core';
import { componentCircuit, testChip } from './helpers';

describe('typed reusable chip hierarchy', () => {
  it('flattens nested chips and keeps each module boundary observable', () => {
    const base = testChip();
    const outer: ChipDefinition = { ...testChip('outer'), circuit: componentCircuit('CHIP', { chipId: base.id }, [base]) };
    const chips = [base, outer];
    const simulator = new Simulator(compileCircuit(componentCircuit('CHIP', { chipId: outer.id }, chips), chips));
    for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) {
      simulator.setInputs({ a, b });
      expect(simulator.read('gate', 'out')).toBe(a ^ b);
      expect(simulator.read('gate/gate', 'a')).toBe(a);
      expect(simulator.read('gate/gate', 'out')).toBe(a ^ b);
    }
    expect(simulator.compiled.stats.gates).toBe(4);
    expect(simulator.compiled.operations.every(operation => operation.kind === 'NAND')).toBe(true);
  });

  it('keeps two instances of a sequential custom chip independent', () => {
    const definition = getChipForComponent(createComponent('REGISTER', 'r', undefined, { width: 8 }))!;
    definition.id = 'custom-register';
    const builder = new CircuitBuilder('instances', 'Independent instances');
    builder.add('CLOCK', 'clock');
    const enable = builder.constant(1);
    for (const id of ['left', 'right']) {
      builder.add('CHIP', id, { chipId: definition.id });
      const data = builder.input(id, 8);
      builder.wire(data, { node: id, pin: 'd' });
      builder.wire(enable, { node: id, pin: 'en' });
      builder.wire({ node: 'clock', pin: 'out' }, { node: id, pin: 'clk' });
    }
    const simulator = new Simulator(compileCircuit(builder.circuit, [definition]));
    simulator.setInputs({ 'in-left': 17, 'in-right': 99 });
    simulator.step();
    expect(simulator.read('left', 'q')).toBe(17);
    expect(simulator.read('right', 'q')).toBe(99);
    expect(Object.keys(simulator.snapshot().state)).toHaveLength(2);
    simulator.setInput('in-left', 42); simulator.step();
    expect(simulator.read('left', 'q')).toBe(42);
    expect(simulator.read('right', 'q')).toBe(99);
  });

  it('rejects broken chip references and inconsistent interface widths', () => {
    const missing: Circuit = { id: 'missing', name: 'Missing', version: 1, components: [createComponent('CHIP', 'chip', undefined, { chipId: 'absent' })], connections: [] };
    expect(validateCircuit(missing).map(item => item.code)).toContain('MISSING_CHIP');
    const definition = testChip();
    const circuit = componentCircuit('CHIP', { chipId: definition.id }, [definition]);
    definition.inputs[0]!.width = 2;
    expect(validateCircuit(circuit, [definition]).map(item => item.code)).toContain('WIDTH_MISMATCH');
  });

  it('rejects unbound internal inputs and duplicate port bindings', () => {
    const definition = testChip();
    const circuit = componentCircuit('CHIP', { chipId: definition.id }, [definition]);
    definition.circuit.components.push(createComponent('INPUT', 'private-input'));
    expect(validateCircuit(circuit, [definition]).map(item => item.code)).toContain('UNBOUND_PORT');
    definition.inputs.push({ name: 'alias', width: 1, nodeId: 'a' });
    expect(validateCircuit(circuit, [definition]).map(item => item.code)).toContain('INVALID_PORT');
  });

  it('detects direct and mutually recursive chip definitions before expansion', () => {
    const definition: ChipDefinition = { id: 'a', name: 'A', description: '', version: 1, inputs: [], outputs: [], circuit: { id: 'a-body', name: 'A', version: 1, components: [createComponent('CHIP', 'self', undefined, { chipId: 'a' })], connections: [] } };
    const circuit = componentCircuit('CHIP', { chipId: 'a' }, [definition]);
    expect(validateCircuit(circuit, [definition]).map(item => item.code)).toContain('RECURSIVE_CHIP');
    const other: ChipDefinition = { ...definition, id: 'b', circuit: { ...definition.circuit, components: [createComponent('CHIP', 'to-a', undefined, { chipId: 'a' })] } };
    definition.circuit.components[0]!.config.chipId = 'b';
    expect(validateCircuit(circuit, [definition, other]).map(item => item.code)).toContain('RECURSIVE_CHIP');
  });

  it('catches combinational loops across chip boundaries', () => {
    const definition = testChip();
    const circuit = componentCircuit('CHIP', { chipId: definition.id }, [definition]);
    circuit.connections.find(wire => wire.id === 'in-a')!.from = { node: 'gate', pin: 'out' };
    expect(validateCircuit(circuit, [definition]).map(item => item.code)).toContain('COMBINATIONAL_LOOP');
  });

  it('preserves topology and behavior through portable JSON serialization', () => {
    const definition = testChip();
    const circuit = componentCircuit('CHIP', { chipId: definition.id }, [definition]);
    const original = new Simulator(compileCircuit(circuit, [definition]));
    const restored = JSON.parse(JSON.stringify({ circuit, chips: [definition] })) as { circuit: Circuit; chips: ChipDefinition[] };
    const copy = new Simulator(compileCircuit(restored.circuit, restored.chips));
    original.setInputs({ a: 1, b: 0 }); copy.setInputs({ a: 1, b: 0 });
    expect(copy.snapshot()).toEqual(original.snapshot());
  });
});
