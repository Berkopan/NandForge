import { describe, expect, it } from 'vitest';
import { compileCircuit, createTemplate, Simulator, TEMPLATES, truthTable } from '../../src/core';

describe('library templates and real-simulator truth tables', () => {
  for (const template of TEMPLATES) it(`${template.name} compiles with no missing wires and runs`, () => {
    const circuit = createTemplate(template.id);
    const simulator = new Simulator(compileCircuit(circuit));
    simulator.step();
    expect(simulator.cycle).toBe(1);
    expect(simulator.compiled.diagnostics).toEqual([]);
    expect(circuit.components.every(node => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
  });

  it('enumerates complete real AND and NAND-built XOR truth tables with stable named ports', () => {
    const and = truthTable(createTemplate('and'));
    expect(and.diagnostics).toEqual([]);
    expect(and.inputs.map(port => port.name)).toEqual(['a', 'b']);
    expect(and.rows.map(row => row.outputs['out-out'])).toEqual([0, 0, 0, 1]);
    const xor = truthTable(createTemplate('nand-xor'));
    expect(xor.rows.map(row => row.outputs['out-out'])).toEqual([0, 1, 1, 0]);
  });

  it('reports stateful, oversized, and incomplete truth-table requests instead of inventing results', () => {
    expect(truthTable(createTemplate('register8')).diagnostics[0]?.code).toBe('TRUTH_TABLE_SEQUENTIAL');
    expect(truthTable(createTemplate('adder8')).diagnostics[0]?.code).toBe('TRUTH_TABLE_LIMIT');
    const incomplete = createTemplate('and'); incomplete.connections = [];
    expect(truthTable(incomplete).diagnostics.some(item => item.code === 'MISSING_INPUT')).toBe(true);
    expect(truthTable(createTemplate('blank')).diagnostics[0]?.code).toBe('TRUTH_TABLE_OUTPUT');
  });

  it('recreates detached templates and rejects unknown names', () => {
    const first = createTemplate('and');
    first.components.length = 0;
    expect(createTemplate('and').components.length).toBeGreaterThan(0);
    expect(() => createTemplate('not-a-template')).toThrow();
  });
});
