import { describe, expect, it } from 'vitest';
import { compileCircuit, Simulator } from '../../src/core';
import { buildAluChip } from '../../src/cpu/alu';
import { CircuitBuilder } from '../../src/cpu/builder';

function alu(): Simulator {
  const chip = buildAluChip();
  const builder = new CircuitBuilder('alu-test', 'ALU verification');
  builder.chip('alu', chip, {
    a: builder.input('a', 8), b: builder.input('b', 8), immediate: builder.input('immediate', 8),
    external: builder.input('external', 8), operation: builder.input('operation', 4),
  });
  builder.output('result', builder.ref('alu', 'result'), 8);
  builder.output('carry', builder.ref('alu', 'carry'));
  return new Simulator(compileCircuit(builder.circuit, [chip]));
}

describe('CPU gate-level ALU', () => {
  it('exhaustively verifies all 65,536 byte pairs for ADD and SUB, including carry/no-borrow', () => {
    const simulator = alu();
    for (const op of [2, 3]) {
      simulator.setInput('operation', op);
      for (let a = 0; a < 256; a += 1) {
        simulator.setInput('a', a);
        for (let b = 0; b < 256; b += 1) {
          simulator.setInput('b', b);
          const expected = (op === 2 ? a + b : a - b) & 255;
          const carry = op === 2 ? Number(a + b > 255) : Number(a >= b);
          const result = simulator.read('alu', 'result');
          const actualCarry = simulator.read('alu', 'carry');
          if (result !== expected || actualCarry !== carry) {
            throw new Error(`ALU op=${op}, a=${a}, b=${b}: result=${result}/${expected}, C=${actualCarry}/${carry}`);
          }
        }
      }
    }
  }, 120_000);

  it('exhaustively verifies NOT and fixed wiring shifts over all 256 input values', () => {
    const simulator = alu();
    for (const operation of [7, 8, 9]) {
      simulator.setInput('operation', operation);
      for (let a = 0; a < 256; a += 1) {
        simulator.setInput('a', a);
        const expected = operation === 7 ? 255 - a : operation === 8 ? (a * 2) % 256 : Math.floor(a / 2);
        const carry = operation === 8 ? Number(a >= 128) : operation === 9 ? a % 2 : 0;
        expect(simulator.read('alu', 'result')).toBe(expected);
        expect(simulator.read('alu', 'carry')).toBe(carry);
      }
    }
  });

  it('routes all load sources independently and uses only the selected bitwise operation', () => {
    const simulator = alu();
    simulator.setInput('immediate', 37);
    simulator.setInput('b', 204);
    simulator.setInput('external', 19);
    for (const [op, expected] of [[0, 37], [1, 204], [10, 19], [11, 0], [15, 0]]) {
      simulator.setInput('operation', op!);
      expect(simulator.read('alu', 'result')).toBe(expected);
    }
    let seed = 0xabc123;
    for (let i = 0; i < 4096; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const a = (seed >>> 8) & 255;
      const b = (seed >>> 16) & 255;
      simulator.setInput('a', a);
      simulator.setInput('b', b);
      for (const [op, expected] of [[4, a & b], [5, a | b], [6, a ^ b]]) {
        simulator.setInput('operation', op!);
        const result = simulator.read('alu', 'result');
        if (result !== expected) throw new Error(`Bitwise op=${op} a=${a} b=${b} result=${result} expected=${expected}`);
      }
    }
  });
});
