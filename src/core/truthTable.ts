import { compileCircuit, CircuitError } from './compiler';
import { Simulator } from './simulator';
import type { ChipDefinition, Circuit, Diagnostic } from './types';

export interface TruthTablePort { nodeId: string; name: string; width: number }
export interface TruthTableRow { inputs: Record<string, number>; outputs: Record<string, number> }
export interface TruthTableResult {
  inputs: TruthTablePort[];
  outputs: TruthTablePort[];
  rows: TruthTableRow[];
  diagnostics: Diagnostic[];
}

/** Enumerate actual simulator outputs, with an explicit work limit for an interactive browser. */
export function truthTable(circuit: Circuit, chips: readonly ChipDefinition[] = [], maxInputBits = 8): TruthTableResult {
  const ports = (type: 'INPUT' | 'OUTPUT'): TruthTablePort[] => circuit.components.filter(component => component.type === type)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(component => ({ nodeId: component.id, name: component.label || component.id, width: component.config.width ?? 1 }));
  const result: TruthTableResult = { inputs: ports('INPUT'), outputs: ports('OUTPUT'), rows: [], diagnostics: [] };
  try {
    const compiled = compileCircuit(circuit, chips);
    result.diagnostics.push(...compiled.diagnostics);
    if (compiled.stats.sequential > 0) {
      result.diagnostics.push({ code: 'TRUTH_TABLE_SEQUENTIAL', message: 'Truth tables describe combinational circuits. Use clock steps and waveforms for stateful circuits.', severity: 'error' });
      return result;
    }
    const inputBits = result.inputs.reduce((sum, input) => sum + input.width, 0);
    if (!Number.isInteger(maxInputBits) || maxInputBits < 0 || maxInputBits > 16 || inputBits > maxInputBits || (2 ** inputBits) * compiled.operations.length > 50_000_000) {
      result.diagnostics.push({ code: 'TRUTH_TABLE_LIMIT', message: `This circuit has ${inputBits} input bits. The current truth-table limit is ${Math.min(Math.max(maxInputBits, 0), 16)} bits and 50 million primitive operations.`, severity: 'error' });
      return result;
    }
    if (result.outputs.length === 0) {
      result.diagnostics.push({ code: 'TRUTH_TABLE_OUTPUT', message: 'Add an output probe to observe the truth table.', severity: 'error' });
      return result;
    }
    const simulator = new Simulator(compiled);
    for (let vector = 0; vector < 2 ** inputBits; vector++) {
      let shift = inputBits;
      const inputs: Record<string, number> = Object.fromEntries(result.inputs.map(input => {
        shift -= input.width;
        return [input.nodeId, (vector >>> shift) & ((1 << input.width) - 1)];
      }));
      simulator.setInputs(inputs);
      result.rows.push({ inputs, outputs: Object.fromEntries(result.outputs.map(output => [output.nodeId, simulator.read(output.nodeId, 'in')])) });
    }
    return result;
  } catch (error) {
    if (error instanceof CircuitError) { result.diagnostics.push(...error.diagnostics); return result; }
    throw error;
  }
}
