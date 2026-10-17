import { compileCircuit, createComponent, getComponentSpec, Simulator } from '../../src/core';
import type { ChipDefinition, Circuit, ComponentConfig, ComponentType } from '../../src/core';

export function componentCircuit(type: ComponentType, config: ComponentConfig = {}, chips: ChipDefinition[] = []): Circuit {
  const gate = createComponent(type, 'gate', { x: 250, y: 100 }, config);
  const spec = getComponentSpec(gate, chips);
  const circuit: Circuit = { id: 'test-circuit', name: type, version: 1, components: [gate], connections: [] };
  for (const pin of spec.inputs) {
    const source = createComponent(pin.name === 'clk' ? 'CLOCK' : 'INPUT', pin.name, { x: 0, y: 0 }, { width: pin.width });
    circuit.components.push(source);
    circuit.connections.push({ id: `in-${pin.name}`, from: { node: source.id, pin: 'out' }, to: { node: 'gate', pin: pin.name } });
  }
  for (const pin of spec.outputs) {
    const output = createComponent('OUTPUT', `out-${pin.name}`, { x: 500, y: 0 }, { width: pin.width });
    circuit.components.push(output);
    circuit.connections.push({ id: `out-${pin.name}`, from: { node: 'gate', pin: pin.name }, to: { node: output.id, pin: 'in' } });
  }
  return circuit;
}

export function componentSimulator(type: ComponentType, config: ComponentConfig = {}): Simulator {
  return new Simulator(compileCircuit(componentCircuit(type, config)));
}

export function testChip(id = 'xor-chip'): ChipDefinition {
  return {
    id, name: 'XOR', description: 'Test chip', version: 1,
    inputs: [{ name: 'a', width: 1, nodeId: 'a' }, { name: 'b', width: 1, nodeId: 'b' }],
    outputs: [{ name: 'out', width: 1, nodeId: 'out-out' }], circuit: componentCircuit('XOR'),
  };
}

export function rng(seed = 0x13579bdf): () => number {
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
}
