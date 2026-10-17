import type { ChipDefinition, Endpoint } from '../core/types';
import { CircuitBuilder } from './builder';

/** A real combinational datapath, with ripple-carry arithmetic and a mux selection tree. */
export function buildAluChip(): ChipDefinition {
  const b = new CircuitBuilder('cpu-alu', '8-bit ALU');
  const a = b.input('a', 8);
  const memory = b.input('b', 8);
  const immediate = b.input('immediate', 8);
  const external = b.input('external', 8);
  const selection = b.split(b.input('operation', 4), 4, 'operation-bits');
  const zero = b.constant(0);
  const one = b.constant(1);
  const zeroByte = b.constant(0, 8);

  const add = b.adder(a, memory, zero, 8, 'ripple-add');
  const subtract = b.adder(a, b.unary('NOT', memory, 8, 'complement-b'), one, 8, 'ripple-subtract');
  const aBits = b.split(a, 8, 'a-bits');
  const left = b.join([zero, ...aBits.slice(0, 7)], 'shift-left-wiring');
  const right = b.join([...aBits.slice(1), zero], 'shift-right-wiring');

  const results: Endpoint[] = [
    immediate, memory, add.sum, subtract.sum,
    b.binary('AND', a, memory, 8, 'and-bits'),
    b.binary('OR', a, memory, 8, 'or-bits'),
    b.binary('XOR', a, memory, 8, 'xor-bits'),
    b.unary('NOT', a, 8, 'invert-a'),
    left, right, external, zeroByte, zeroByte, zeroByte, zeroByte, zeroByte,
  ];
  const carries = [zero, zero, add.carry, subtract.carry, zero, zero, zero, zero, aBits[7]!, aBits[0]!, zero, zero, zero, zero, zero, zero];

  function select(values: Endpoint[], width: number, name: string): Endpoint {
    let level = values;
    for (let bit = 0; bit < selection.length; bit += 1) {
      const next: Endpoint[] = [];
      for (let i = 0; i < level.length; i += 2) {
        next.push(b.mux(level[i]!, level[i + 1]!, selection[bit]!, width, `${name}-${bit}-${i / 2}`));
      }
      level = next;
    }
    return level[0]!;
  }

  b.output('result', select(results, 8, 'result-mux'), 8);
  b.output('carry', select(carries, 1, 'carry-mux'));
  return b.definition('Unsigned modular arithmetic, bitwise logic, fixed wiring shifts and a four-level selection tree. All combinational components expand to NAND. SUB uses A + NOT(B) + 1, so its carry means no borrow.');
}
