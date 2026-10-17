import { describe, expect, it } from 'vitest';
import { CircuitBuilder, compileCircuit, createComponent, createTemplate, getChipForComponent, getComponentSpec, Simulator, truthTable, validateCircuit } from '../../src/core';
import type { Circuit } from '../../src/core/types';
import { arrangeCircuit, connectionProblem, copySelection, createChipFromCircuit, deleteSelection, formatSignal, parseMemoryContents, pasteFragment, readScopedSignal, replaceInputConnection } from '../../src/editor/model';

describe('editor graph operations preserve executable topology', () => {
  it('copies and pastes a full adder with its distinct sum and carry pins', () => {
    const circuit = createTemplate('full-adder');
    const original = structuredClone(circuit);
    const fragment = copySelection(circuit, new Set(circuit.components.map(component => component.id)));
    let serial = 0;
    const result = pasteFragment(circuit, fragment, { x: 20, y: 40 }, prefix => `${prefix}-copy-${serial++}`);
    expect(result.ids.size).toBe(circuit.components.length);
    expect(result.circuit.connections).toHaveLength(circuit.connections.length * 2);
    const simulator = new Simulator(compileCircuit(result.circuit));
    for (let vector = 0; vector < 8; vector++) {
      for (const input of result.circuit.components.filter(component => component.type === 'INPUT')) {
        const index = ['a', 'b', 'cin'].indexOf(input.label!);
        simulator.setInput(input.id, (vector >>> index) & 1);
      }
      const sum = (vector & 1) + ((vector >>> 1) & 1) + ((vector >>> 2) & 1);
      for (const output of result.circuit.components.filter(component => component.type === 'OUTPUT')) {
        expect(simulator.read(output.id, 'in')).toBe(output.label === 'sum' ? sum % 2 : Math.floor(sum / 2));
      }
    }
    expect(circuit).toEqual(original);
    expect(result.circuit.connections.filter(wire => wire.from.pin === 'cout')).toHaveLength(2);
  });

  it('does not copy dangling outside wires, and deep-clones mutable memory configuration', () => {
    const circuit = createTemplate('memory');
    const memory = circuit.components.find(component => component.type === 'RAM')!;
    const fragment = copySelection(circuit, new Set([memory.id]));
    expect(fragment.connections).toEqual([]);
    fragment.components[0]!.config.contents![0] = 222;
    expect(memory.config.contents![0]).toBe(3);
    const result = pasteFragment(circuit, fragment);
    result.circuit.components.at(-1)!.config.contents![0] = 111;
    expect(fragment.components[0]!.config.contents![0]).toBe(222);
  });

  it('deletes incident connections along with a selected node but leaves unrelated wires', () => {
    const circuit = createTemplate('and');
    const outputWire = circuit.connections.find(wire => wire.to.node === 'out-out')!;
    const deleted = deleteSelection(circuit, new Set(['in-a']), new Set());
    expect(deleted.connections.every(wire => wire.to.node !== 'in-a' && wire.from.node !== 'in-a')).toBe(true);
    expect(deleted.connections.some(wire => wire.id === outputWire.id)).toBe(true);
    const disconnected = deleteSelection(deleted, new Set(), new Set([outputWire.id]));
    expect(disconnected.connections.some(wire => wire.id === outputWire.id)).toBe(false);
    expect(disconnected.components).toHaveLength(circuit.components.length - 1);
  });

  it('rejects width and driver conflicts and replaces an inspector connection atomically', () => {
    const circuit = createTemplate('and');
    expect(connectionProblem(circuit, { node: 'in-a', pin: 'out' }, { node: 'gate', pin: 'b' })).toBe('alreadyDriven');
    const withBus = { ...circuit, components: [...circuit.components, createComponent('INPUT', 'bus', { x: 0, y: 0 }, { width: 8 })] };
    expect(connectionProblem(withBus, { node: 'bus', pin: 'out' }, { node: 'gate', pin: 'a' })).toBe('mismatchedWidth');
    expect(connectionProblem(circuit, { node: 'gate', pin: 'a' }, { node: 'in-a', pin: 'out' })).toBe('invalidPin');
    const changed = replaceInputConnection(circuit, { node: 'gate', pin: 'b' }, { node: 'in-a', pin: 'out' });
    const simulator = new Simulator(compileCircuit(changed));
    for (let input = 0; input <= 1; input++) {
      simulator.setInput('in-a', input);
      expect(simulator.read('out-out', 'in')).toBe(input);
    }
    expect(changed.connections.filter(wire => wire.to.node === 'gate' && wire.to.pin === 'b')).toHaveLength(1);
    expect(() => replaceInputConnection(withBus, { node: 'gate', pin: 'a' }, { node: 'bus', pin: 'out' })).toThrow('mismatchedWidth');
  });
});

describe('custom chip creation uses real logic and typed selection boundaries', () => {
  it('saves NAND XOR, instantiates it twice, and evaluates all input combinations', () => {
    const circuit = createTemplate('nand-xor');
    const chip = createChipFromCircuit(circuit, null, 'My XOR', 'Four primitive NANDs');
    expect(chip.inputs).toHaveLength(2);
    expect(chip.outputs).toHaveLength(1);
    expect(chip.circuit.components.filter(component => component.type === 'NAND')).toHaveLength(4);
    const builder = new CircuitBuilder('host', 'Two saved XORs');
    const a = builder.input('a');
    const b = builder.input('b');
    for (const index of [0, 1]) {
      const node = builder.add('CHIP', `chip-${index}`, { chipId: chip.id });
      builder.wire(a, { node: node.id, pin: chip.inputs.find(port => port.name === 'a')!.name });
      builder.wire(b, { node: node.id, pin: chip.inputs.find(port => port.name === 'b')!.name });
      builder.output(`result${index}`, 1, { node: node.id, pin: chip.outputs[0]!.name });
    }
    const table = truthTable(builder.circuit, [chip]);
    expect(table.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
    expect(table.rows).toHaveLength(4);
    for (const row of table.rows) for (const output of table.outputs) expect(row.outputs[output.nodeId]).toBe(row.inputs['in-a']! ^ row.inputs['in-b']!);
  });

  it('extracts only the four NAND gates and creates two shared input ports across fanout', () => {
    const circuit = createTemplate('nand-xor');
    const selected = new Set(circuit.components.filter(component => component.type === 'NAND').map(component => component.id));
    const chip = createChipFromCircuit(circuit, selected, 'Extracted XOR', 'Automatically bound ports');
    expect(chip.inputs).toHaveLength(2);
    expect(chip.outputs).toHaveLength(1);
    expect(validateCircuit(chip.circuit)).toEqual([]);
    const table = truthTable(chip.circuit);
    expect(table.rows).toHaveLength(4);
    for (const row of table.rows) expect(Object.values(row.outputs)[0]).toBe(Object.values(row.inputs)[0]! ^ Object.values(row.inputs)[1]!);
    expect(circuit.components).toHaveLength(7);
  });

  it('retains separate width-8 sum and width-1 carry output ports', () => {
    const circuit = createTemplate('adder8');
    const chip = createChipFromCircuit(circuit, new Set(['gate']), 'Adder slice', 'Typed bus example');
    expect(chip.outputs.map(port => port.width).sort((a, b) => a - b)).toEqual([1, 8]);
    const instance = createComponent('CHIP', 'instance', undefined, { chipId: chip.id });
    expect(getComponentSpec(instance, [chip]).inputs.map(pin => pin.width).sort((a, b) => a - b)).toEqual([1, 8, 8]);
    const sum = chip.outputs.find(port => port.width === 8)!;
    const carry = chip.outputs.find(port => port.width === 1)!;
    const sim = new Simulator(compileCircuit(chip.circuit));
    const a = chip.inputs.find(port => port.name === 'a')!;
    const b = chip.inputs.find(port => port.name === 'b')!;
    sim.setInput(a.nodeId, 255);
    sim.setInput(b.nodeId, 1);
    expect(sim.read(sum.nodeId, 'in')).toBe(0);
    expect(sim.read(carry.nodeId, 'in')).toBe(1);
  });

  it('rejects invalid or output-free modules instead of creating unusable chips', () => {
    const circuit = createTemplate('and');
    expect(() => createChipFromCircuit({ ...circuit, connections: [] }, null, 'Bad', '')).toThrow('chipInvalid');
    expect(() => createChipFromCircuit({ ...circuit, components: circuit.components.filter(component => component.type === 'INPUT'), connections: [] }, null, 'No output', '')).toThrow('chipNeedsPorts');
  });
});

describe('editor configuration and layout', () => {
  it('reads live sequential state inside the correct nested custom-chip instance', () => {
    const registerCircuit = createTemplate('register8');
    const register = registerCircuit.components.find(component => component.type === 'REGISTER')!;
    const internals = getChipForComponent(register)!;
    const dff = internals.circuit.components.find(component => component.type === 'DFF')!;
    const saved = createChipFromCircuit(registerCircuit, null, 'Clocked unit', 'Real register state');
    const builder = new CircuitBuilder('host-registers', 'Independent instances');
    const enable = builder.constant(1);
    const firstData = builder.input('first-data', 8, 42);
    const secondData = builder.input('second-data', 8, 19);
    for (const [id, data] of [['first', firstData], ['second', secondData]] as const) {
      builder.add('CHIP', id, { chipId: saved.id });
      builder.wire(data, { node: id, pin: 'd' });
      builder.wire(enable, { node: id, pin: 'en' });
    }
    const simulator = new Simulator(compileCircuit(builder.circuit, [saved]));
    simulator.step();
    expect(readScopedSignal(simulator, 'first/gate/', dff.id, 'q')).toBe(42);
    expect(readScopedSignal(simulator, 'second/gate/', dff.id, 'q')).toBe(19);
    simulator.setInput('in-first-data', 123);
    expect(readScopedSignal(simulator, 'first/gate/', dff.id, 'q')).toBe(42);
    simulator.step();
    expect(readScopedSignal(simulator, 'first/gate/', dff.id, 'q')).toBe(123);
    expect(readScopedSignal(simulator, 'second/gate/', dff.id, 'q')).toBe(19);
    expect(readScopedSignal(simulator, 'missing/', dff.id, 'q')).toBeUndefined();
  });

  it('parses bounded memory contents without executing expressions', () => {
    expect(parseMemoryContents('12, 0xFF\n0b101 0', 8, 2)).toEqual([12, 255, 5, 0]);
    expect(parseMemoryContents('', 8, 2)).toEqual([]);
    for (const text of ['256', '-1', '1.5', '1e2', 'alert(1)', '1+1', '0x', '1 2 3 4 5']) expect(parseMemoryContents(text, 8, 2)).toBeNull();
    expect(formatSignal(255, 8, 'binary')).toBe('11111111');
    expect(formatSignal(1, 16, 'hex')).toBe('0x0001');
    expect(formatSignal(undefined, 1)).toBe('—');
  });

  it('arranges feedback circuits deterministically without overlapping identical positions or changing behavior', () => {
    const circuit = createTemplate('register8');
    const before = new Simulator(compileCircuit(circuit));
    const arranged = arrangeCircuit(circuit);
    const after = new Simulator(compileCircuit(arranged));
    expect(new Set(arranged.components.map(component => `${component.position.x}:${component.position.y}`)).size).toBe(arranged.components.length);
    expect(arrangeCircuit(circuit)).toEqual(arranged);
    before.step(); after.step();
    expect(before.read('out-q', 'in')).toBe(42);
    expect(after.read('out-q', 'in')).toBe(42);
    expect(circuit.components).not.toEqual(arranged.components);
  });

  it('terminates layout on an unsupported loop so diagnostics remain inspectable', () => {
    const cyclic: Circuit = { id: 'cycle', name: 'Cycle', version: 1, components: [createComponent('NOT', 'a'), createComponent('NOT', 'b')], connections: [{ id: 'ab', from: { node: 'a', pin: 'out' }, to: { node: 'b', pin: 'in' } }, { id: 'ba', from: { node: 'b', pin: 'out' }, to: { node: 'a', pin: 'in' } }] };
    expect(arrangeCircuit(cyclic).components.every(component => Number.isFinite(component.position.x))).toBe(true);
    expect(validateCircuit(arrangeCircuit(cyclic)).some(diagnostic => diagnostic.code === 'COMBINATIONAL_LOOP')).toBe(true);
  });
});
