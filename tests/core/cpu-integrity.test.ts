import { expect, it } from 'vitest';
import { buildCpuCircuit } from '../../src/cpu/architecture';
import { compileCircuit, createComponent, Simulator } from '../../src/core';

const additionProgram = [0x0103, 0x03f0, 0x0104, 0x04f0, 0x1000, 0xff00];

it('runs the specified 3 + 4 program directly through the generic simulator, without CpuMachine', () => {
  const { circuit, chips } = buildCpuCircuit();
  const simulator = new Simulator(compileCircuit(circuit, chips));
  simulator.setMemory('rom', additionProgram);
  for (let cycle = 0; cycle < additionProgram.length; cycle++) simulator.step();
  expect(simulator.read('registers', 'a')).toBe(7);
  expect(simulator.read('io', 'output')).toBe(7);
  expect(simulator.read('pc', 'pc')).toBe(5);
  expect(simulator.read('registers', 'halted')).toBe(1);
  expect(simulator.getMemory('ram')[240]).toBe(3);
  expect(new Set(simulator.compiled.operations.map(operation => operation.kind))).toEqual(new Set(['NAND', 'SPLIT', 'JOIN', 'RAM', 'ROM']));
});

it('changes executed CPU behavior when an actual ALU wire is changed', () => {
  const { circuit, chips } = buildCpuCircuit();
  const alu = chips.find(chip => chip.id === 'cpu-alu')!;
  const addOperand = alu.circuit.connections.find(wire => wire.to.node === 'ripple-add' && wire.to.pin === 'b')!;
  expect(addOperand).toBeDefined();
  alu.circuit.components.push(createComponent('CONST', 'audit-zero-operand', undefined, { width: 8, value: 0 }));
  addOperand.from = { node: 'audit-zero-operand', pin: 'out' };
  const simulator = new Simulator(compileCircuit(circuit, chips));
  simulator.setMemory('rom', additionProgram);
  for (let cycle = 0; cycle < additionProgram.length; cycle++) simulator.step();
  // RAM still contains 3, but ADD now physically receives a zero bus on its b input.
  expect(simulator.getMemory('ram')[240]).toBe(3);
  expect(simulator.read('io', 'output')).toBe(4);
  expect(simulator.read('registers', 'fault')).toBe(0);
});
