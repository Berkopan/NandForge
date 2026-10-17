import { describe, expect, it } from 'vitest';
import { CircuitBuilder, compileCircuit, createComponent, createTemplate, Simulator } from '../../src/core';
import type { Circuit } from '../../src/core';
import { componentCircuit, componentSimulator } from './helpers';

describe('atomic positive-edge sequential simulation', () => {
  it('retains register state while paused and samples enable at the edge', () => {
    const simulator = componentSimulator('REGISTER', { width: 8, initial: 7 });
    simulator.setInputs({ d: 42, en: 0 });
    expect(simulator.read('gate', 'q')).toBe(7);
    simulator.step();
    expect(simulator.read('gate', 'q')).toBe(7);
    simulator.setInput('en', 1);
    expect(simulator.read('gate', 'q')).toBe(7);
    const observations: number[][] = [];
    simulator.step((phase, current) => observations.push([phase === 'rising' ? 1 : 0, current.read('clk', 'out'), current.read('gate', 'q'), current.cycle]));
    expect(observations).toEqual([[1, 1, 42, 2], [0, 0, 42, 2]]);
    simulator.setInput('d', 99);
    simulator.evaluate();
    expect(simulator.read('gate', 'q')).toBe(42);
    simulator.reset();
    expect(simulator.read('gate', 'q')).toBe(7);
    expect(simulator.cycle).toBe(0);
  });

  it('swaps two registers simultaneously, independent of component or wire order', () => {
    const circuit: Circuit = {
      id: 'swap', name: 'Swap', version: 1,
      components: [createComponent('DFF', 'left', undefined, { width: 8, initial: 1 }), createComponent('DFF', 'right', undefined, { width: 8, initial: 2 }), createComponent('CLOCK', 'clock')],
      connections: [
        { id: 'lr', from: { node: 'left', pin: 'q' }, to: { node: 'right', pin: 'd' } },
        { id: 'rl', from: { node: 'right', pin: 'q' }, to: { node: 'left', pin: 'd' } },
        { id: 'cl', from: { node: 'clock', pin: 'out' }, to: { node: 'left', pin: 'clk' } },
        { id: 'cr', from: { node: 'clock', pin: 'out' }, to: { node: 'right', pin: 'clk' } },
      ],
    };
    const a = new Simulator(compileCircuit(circuit));
    const b = new Simulator(compileCircuit({ ...circuit, components: [...circuit.components].reverse(), connections: [...circuit.connections].reverse() }));
    expect(a.compiled.fingerprint).toBe(b.compiled.fingerprint);
    for (let index = 0; index < 20; index++) {
      a.step(); b.step();
      expect([a.read('left', 'q'), a.read('right', 'q')]).toEqual(index % 2 ? [1, 2] : [2, 1]);
      expect(a.snapshot()).toEqual(b.snapshot());
    }
  });

  it('samples the stable pre-edge data, even if d is the clock itself', () => {
    const circuit = componentCircuit('DFF');
    circuit.components = circuit.components.filter(node => node.id !== 'd');
    circuit.connections = circuit.connections.filter(wire => wire.id !== 'in-d');
    circuit.connections.push({ id: 'clock-as-data', from: { node: 'clk', pin: 'out' }, to: { node: 'gate', pin: 'd' } });
    const simulator = new Simulator(compileCircuit(circuit));
    for (let index = 0; index < 4; index++) { simulator.step(); expect(simulator.read('gate', 'q')).toBe(0); }
  });

  it('recognizes only low-to-high edges during explicit clock-level control', () => {
    const simulator = componentSimulator('DFF', { width: 8 });
    simulator.setInput('d', 12);
    simulator.setClock('clk', 1);
    expect(simulator.read('gate', 'q')).toBe(12);
    simulator.setInput('d', 34);
    simulator.setClock('clk', 1);
    expect(simulator.read('gate', 'q')).toBe(12);
    simulator.setClock('clk', 0);
    expect(simulator.read('gate', 'q')).toBe(12);
    simulator.setClock('clk', 1);
    expect(simulator.read('gate', 'q')).toBe(34);
    expect(simulator.cycle).toBe(0);
  });

  it('supports a NAND-inverted clock by sampling its positive edge on the source falling phase', () => {
    const circuit = componentCircuit('DFF', { width: 8 });
    circuit.components.push(createComponent('NOT', 'inverted-clock'));
    circuit.connections = circuit.connections.filter(wire => wire.id !== 'in-clk');
    circuit.connections.push(
      { id: 'clock-in', from: { node: 'clk', pin: 'out' }, to: { node: 'inverted-clock', pin: 'in' } },
      { id: 'clock-out', from: { node: 'inverted-clock', pin: 'out' }, to: { node: 'gate', pin: 'clk' } },
    );
    const simulator = new Simulator(compileCircuit(circuit));
    simulator.setInput('d', 77);
    const samples: number[] = [];
    simulator.step((_, current) => samples.push(current.read('gate', 'q')));
    expect(samples).toEqual([0, 77]);
  });

  it('resolves NAND-derived clock gating on explicit phases without inventing input-triggered edges', () => {
    const circuit = componentCircuit('DFF', { width: 8 });
    circuit.components.push(createComponent('AND', 'clock-enable'), createComponent('INPUT', 'enable'));
    circuit.connections = circuit.connections.filter(wire => wire.id !== 'in-clk');
    circuit.connections.push(
      { id: 'source-clock', from: { node: 'clk', pin: 'out' }, to: { node: 'clock-enable', pin: 'a' } },
      { id: 'enable-clock', from: { node: 'enable', pin: 'out' }, to: { node: 'clock-enable', pin: 'b' } },
      { id: 'gated-clock', from: { node: 'clock-enable', pin: 'out' }, to: { node: 'gate', pin: 'clk' } },
    );
    const simulator = new Simulator(compileCircuit(circuit));
    simulator.setInput('d', 88);
    simulator.step(); expect(simulator.read('gate', 'q')).toBe(0);
    simulator.setInput('enable', 1);
    expect(simulator.read('gate', 'q')).toBe(0);
    simulator.step(); expect(simulator.read('gate', 'q')).toBe(88);
    simulator.setInput('enable', 0); simulator.setClock('clk', 1);
    simulator.setInputs({ enable: 1, d: 99 });
    expect(simulator.read('gate', 'q')).toBe(88);
    simulator.setClock('clk', 0); simulator.setClock('clk', 1);
    expect(simulator.read('gate', 'q')).toBe(99);
  });

  it('implements enabled modulo counting with synchronous reset priority', () => {
    const simulator = componentSimulator('COUNTER', { width: 8, initial: 254 });
    simulator.setInput('en', 1);
    simulator.step(); expect(simulator.read('gate', 'q')).toBe(255);
    simulator.step(); expect(simulator.read('gate', 'q')).toBe(0);
    for (let index = 0; index < 257; index++) simulator.step();
    expect(simulator.read('gate', 'q')).toBe(1);
    simulator.setInput('en', 0);
    simulator.step(); expect(simulator.read('gate', 'q')).toBe(1);
    simulator.setInput('reset', 1);
    expect(simulator.read('gate', 'q')).toBe(1);
    simulator.step(); expect(simulator.read('gate', 'q')).toBe(0);
  });
});

describe('idealized synchronous-write memory', () => {
  it('reads ROM asynchronously across its complete address range', () => {
    const contents = Array.from({ length: 256 }, (_, index) => (index * 997) & 65535);
    const simulator = componentSimulator('ROM', { width: 16, addressWidth: 8, contents });
    for (let address = 0; address < 256; address++) {
      simulator.setInput('addr', address);
      expect(simulator.read('gate', 'out')).toBe(contents[address]);
    }
    simulator.setMemory('gate', [65535]);
    simulator.setInput('addr', 0); expect(simulator.read('gate', 'out')).toBe(65535);
    simulator.setInput('addr', 255); expect(simulator.read('gate', 'out')).toBe(0);
    simulator.reset(); expect(simulator.read('gate', 'out')).toBe(contents[0]);
  });

  it('writes only on enabled rising edges and exposes the new memory value afterward', () => {
    const simulator = componentSimulator('RAM', { width: 8, addressWidth: 4, contents: [11] });
    simulator.setInputs({ addr: 15, d: 255, we: 1 });
    expect(simulator.read('gate', 'out')).toBe(0);
    simulator.step(); expect(simulator.read('gate', 'out')).toBe(255);
    simulator.setInputs({ d: 42, we: 0 });
    simulator.step(); expect(simulator.getMemory('gate')[15]).toBe(255);
    const detached = simulator.getMemory('gate'); detached[15] = 7;
    expect(simulator.getMemory('gate')[15]).toBe(255);
    expect(() => simulator.setMemory('gate', [256])).toThrow();
    expect(() => simulator.setMemory('gate', new Array<number>(17).fill(0))).toThrow();
    expect(simulator.getMemory('gate')[15]).toBe(255);
    simulator.reset(); expect(simulator.getMemory('gate')[0]).toBe(11);
    expect(simulator.getMemory('gate')[15]).toBe(0);
  });

  it('samples old RAM output, write address, and data before simultaneous register updates', () => {
    const builder = new CircuitBuilder('atomic-memory', 'Atomic memory');
    builder.add('CLOCK', 'clock');
    builder.add('DFF', 'address', { width: 2, initial: 0 });
    builder.add('DFF', 'readback', { width: 8 });
    builder.add('RAM', 'ram', { width: 8, addressWidth: 2, contents: [11, 22, 33, 44] });
    const data = builder.constant(55, 8);
    const enable = builder.constant(1);
    builder.wire(builder.constant(1, 2), { node: 'address', pin: 'd' });
    builder.wire({ node: 'ram', pin: 'out' }, { node: 'readback', pin: 'd' });
    builder.wire({ node: 'address', pin: 'q' }, { node: 'ram', pin: 'addr' });
    builder.wire(data, { node: 'ram', pin: 'd' });
    builder.wire(enable, { node: 'ram', pin: 'we' });
    for (const node of ['address', 'readback', 'ram']) builder.wire({ node: 'clock', pin: 'out' }, { node, pin: 'clk' });
    const simulator = new Simulator(compileCircuit(builder.circuit));
    simulator.step();
    expect(simulator.read('readback', 'q')).toBe(11);
    expect(simulator.read('address', 'q')).toBe(1);
    expect(simulator.getMemory('ram')).toEqual([55, 22, 33, 44]);
    expect(simulator.read('ram', 'out')).toBe(22);
  });
});

describe('snapshot, restore, reset, and deterministic replay', () => {
  it('round-trips all inputs, memory, clocks and state through JSON and replays identically', () => {
    const simulator = new Simulator(compileCircuit(createTemplate('memory')));
    simulator.setInputs({ 'in-addr': 2, 'in-d': 99, 'in-we': 1 });
    simulator.step();
    const baseline = JSON.parse(JSON.stringify(simulator.snapshot())) as ReturnType<Simulator['snapshot']>;
    const trace = () => {
      const states = [];
      for (let index = 0; index < 16; index++) {
        simulator.setInputs({ 'in-addr': index, 'in-d': index * 7, 'in-we': index % 2 });
        simulator.step(); states.push(simulator.snapshot());
      }
      return states;
    };
    const first = trace();
    simulator.restore(baseline);
    expect(simulator.snapshot()).toEqual(baseline);
    expect(trace()).toEqual(first);
  });

  it('restores an in-progress high clock level without inventing a second edge', () => {
    const simulator = componentSimulator('DFF', { width: 8 });
    simulator.setInput('d', 12); simulator.setClock('clk', 1);
    const snapshot = simulator.snapshot();
    simulator.setClock('clk', 0); simulator.setInput('d', 55); simulator.setClock('clk', 1);
    simulator.restore(snapshot);
    simulator.setInput('d', 77); simulator.setClock('clk', 1);
    expect(simulator.read('gate', 'q')).toBe(12);
    expect(simulator.read('clk', 'out')).toBe(1);
    simulator.setClock('clk', 0); simulator.setClock('clk', 1);
    expect(simulator.read('gate', 'q')).toBe(77);
  });

  it('rejects malformed or topology-mismatched snapshots before changing the live simulation', () => {
    const simulator = componentSimulator('REGISTER', { width: 8 });
    simulator.setInputs({ d: 42, en: 1 }); simulator.step();
    const valid = simulator.snapshot();
    const invalid = { ...valid, state: { ...valid.state, unexpected: 7 } };
    expect(() => simulator.restore(invalid)).toThrow();
    expect(simulator.snapshot()).toEqual(valid);
    expect(() => simulator.restore({ ...valid, inputs: { d: Number.NaN, en: 1 } })).toThrow();
    expect(simulator.snapshot()).toEqual(valid);
    const other = componentSimulator('REGISTER', { width: 8, initial: 1 });
    expect(() => other.restore(valid)).toThrow();
  });
});
