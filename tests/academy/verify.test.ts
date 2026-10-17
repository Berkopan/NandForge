import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../../src/core';
import type { Circuit, Endpoint } from '../../src/core';
import { LESSONS, createLessonCircuit } from '../../src/academy/lessons';
import { verifyLesson } from '../../src/academy/verify';

function lesson(id: string) {
  const result = LESSONS.find((entry) => entry.id === id);
  if (!result) throw new Error(`Missing lesson ${id}`);
  return result;
}

/** Independently constructed solutions; the verifier sees only ordinary user circuit data. */
function solution(id: string): Circuit {
  const definition = lesson(id);
  const b = new CircuitBuilder(`solution-${id}`, `Test solution ${id}`);
  const inputs = Object.fromEntries(definition.inputs.map((port) => [port.name, b.input(port.name, port.width)]));
  const a = inputs.A!;
  const inputB = inputs.B!;
  const nand = (x: Endpoint, y: Endpoint) => b.gate('NAND', { a: x, b: y });
  const out = (name: string, source: Endpoint) => {
    const port = definition.outputs.find((entry) => entry.name === name);
    if (!port) throw new Error(`Missing output ${name}`);
    b.output(name, port.width, source);
  };

  switch (id) {
    case 'signals': out('OUT', a); break;
    case 'nand': out('OUT', nand(a, inputB)); break;
    case 'not': out('OUT', nand(a, a)); break;
    case 'and-or': {
      const notBoth = nand(a, inputB);
      out('AND', nand(notBoth, notBoth));
      out('OR', nand(nand(a, a), nand(inputB, inputB)));
      break;
    }
    case 'xor': {
      const common = nand(a, inputB);
      out('OUT', nand(nand(a, common), nand(inputB, common)));
      break;
    }
    case 'half-adder':
      out('SUM', b.gate('XOR', { a, b: inputB }));
      out('CARRY', b.gate('AND', { a, b: inputB }));
      break;
    case 'full-adder': {
      const firstSum = b.gate('XOR', { a, b: inputB });
      out('SUM', b.gate('XOR', { a: firstSum, b: inputs.CIN! }));
      out('COUT', b.gate('OR', {
        a: b.gate('AND', { a, b: inputB }),
        b: b.gate('AND', { a: firstSum, b: inputs.CIN! }),
      }));
      break;
    }
    case 'mux':
      out('OUT', b.gate('MUX', { a, b: inputB, sel: inputs.SEL! }));
      break;
    case 'bus-adder':
      b.add('ADDER', 'adder', { width: 4 });
      b.wire(a, { node: 'adder', pin: 'a' });
      b.wire(inputB, { node: 'adder', pin: 'b' });
      b.wire(inputs.CIN!, { node: 'adder', pin: 'cin' });
      out('SUM', { node: 'adder', pin: 'sum' });
      out('COUT', { node: 'adder', pin: 'cout' });
      break;
    case 'register':
      b.add('CLOCK', 'clock');
      b.add('REGISTER', 'register', { width: 8 });
      b.wire(inputs.D!, { node: 'register', pin: 'd' });
      b.wire(inputs.EN!, { node: 'register', pin: 'en' });
      b.wire({ node: 'clock', pin: 'out' }, { node: 'register', pin: 'clk' });
      out('Q', { node: 'register', pin: 'q' });
      break;
    case 'alu':
      b.add('ADDER', 'adder', { width: 8 });
      b.wire(a, { node: 'adder', pin: 'a' });
      b.wire(inputB, { node: 'adder', pin: 'b' });
      b.wire(b.constant(0), { node: 'adder', pin: 'cin' });
      out('OUT', b.gate('MUX', { a: { node: 'adder', pin: 'sum' }, b: b.gate('XOR', { a, b: inputB }, 8), sel: inputs.OP! }, 8));
      break;
    default: throw new Error(`No circuit fixture for ${id}`);
  }
  return b.circuit;
}

describe('Academy behavioral verification', () => {
  it.each(LESSONS.filter(({ kind }) => kind !== 'program'))('accepts a independently wired correct $id solution', (definition) => {
    const result = verifyLesson(definition, solution(definition.id), []);
    expect(result.ok, result.message).toBe(true);
    expect(result.tested).toBeGreaterThan(1);
  });

  it('exhaustively checks all four half-adder input combinations', () => {
    const result = verifyLesson(lesson('half-adder'), solution('half-adder'), []);
    expect(result).toMatchObject({ ok: true, tested: 4 });
  });

  it('exhaustively checks all 512 combinations of the four-bit bus adder', () => {
    const result = verifyLesson(lesson('bus-adder'), solution('bus-adder'), []);
    expect(result).toMatchObject({ ok: true, tested: 512 });
  });

  it('uses boundary and deterministic unseen vectors for the eight-bit ALU', () => {
    const result = verifyLesson(lesson('alu'), solution('alu'), []);
    expect(result).toMatchObject({ ok: true, tested: 418 });
  });

  it('rejects a named collection of unwired expected components', () => {
    const definition = lesson('half-adder');
    const circuit = createLessonCircuit(definition);
    circuit.components.push({ id: 'half-adder', type: 'HALF_ADDER', label: 'Correct solution', position: { x: 0, y: 0 }, config: {} });
    const result = verifyLesson(definition, circuit, []);
    expect(result.ok).toBe(false);
    expect(result.tested).toBe(0);
    expect(result.message).toMatch(/required input|connect/i);
  });

  it('reports a concrete counterexample for a plausible but wrong half-adder circuit', () => {
    const circuit = solution('half-adder');
    const xor = circuit.components.find(({ type }) => type === 'XOR')!;
    xor.type = 'OR';
    const result = verifyLesson(lesson('half-adder'), circuit, []);
    expect(result).toMatchObject({ ok: false, tested: 4, inputs: { A: 1, B: 1 }, expected: { SUM: 0, CARRY: 1 }, actual: { SUM: 1, CARRY: 1 } });
  });

  it('does not accept a correct output value hardcoded for the initial switches', () => {
    const definition = lesson('signals');
    const circuit = createLessonCircuit(definition);
    circuit.components.push({ id: 'zero', type: 'CONST', config: { value: 0 }, position: { x: 0, y: 0 } });
    circuit.connections.push({ id: 'wire', from: { node: 'zero', pin: 'out' }, to: { node: 'output-OUT', pin: 'in' } });
    expect(verifyLesson(definition, circuit, [])).toMatchObject({ ok: false, tested: 2, inputs: { A: 1 } });
  });

  it('enforces the instructional NAND constraint even for a behaviorally correct shortcut', () => {
    const definition = lesson('not');
    const b = new CircuitBuilder('shortcut', 'Direct NOT');
    b.output('OUT', 1, b.gate('NOT', { in: b.input('A') }));
    const result = verifyLesson(definition, b.circuit, []);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/only NAND/i);
  });

  it('rejects an unclocked passthrough in the register challenge before the first edge', () => {
    const definition = lesson('register');
    const b = new CircuitBuilder('fake-register', 'Passthrough');
    const d = b.input('D', 8);
    b.input('EN');
    b.add('CLOCK', 'clock');
    b.output('Q', 8, d);
    const result = verifyLesson(definition, b.circuit, []);
    expect(result).toMatchObject({ ok: false, inputs: { D: 37, EN: 1, CLOCK_STEP: 0 }, actual: { Q: 37 } });
  });

  it('tests the disabled register hold behavior instead of only successful writes', () => {
    const circuit = solution('register');
    const enable = circuit.connections.find(({ to }) => to.node === 'register' && to.pin === 'en')!;
    circuit.components.push({ id: 'always', type: 'CONST', position: { x: 0, y: 0 }, config: { value: 1 } });
    enable.from = { node: 'always', pin: 'out' };
    const result = verifyLesson(lesson('register'), circuit, []);
    expect(result).toMatchObject({ ok: false, inputs: { D: 201, EN: 0, CLOCK_STEP: 1 }, expected: { Q: 37 }, actual: { Q: 201 } });
  });

  it('reports interface ambiguity and wrong widths before simulation', () => {
    const circuit = solution('signals');
    circuit.components.push({ id: 'duplicate-input', label: 'A', type: 'INPUT', position: { x: 0, y: 0 }, config: {} });
    expect(verifyLesson(lesson('signals'), circuit, []).message).toMatch(/exactly one/i);
    circuit.components.pop();
    circuit.components.find(({ type }) => type === 'INPUT')!.config.width = 8;
    expect(verifyLesson(lesson('signals'), circuit, []).message).toMatch(/1 bits wide/i);
  });

  it('returns localized success and failure feedback', () => {
    const definition = lesson('half-adder');
    expect(verifyLesson(definition, solution('half-adder'), [], 'tr').message).toContain('gerçek davranış testi geçti');
    expect(verifyLesson(definition, createLessonCircuit(definition), [], 'tr').message).toContain('Devre henüz test edilemiyor');
  });

  it('requires the CPU environment for the programming lesson', () => {
    const definition = lesson('first-program');
    expect(verifyLesson(definition, createLessonCircuit(definition), [])).toMatchObject({ ok: false, tested: 0 });
  });
});
