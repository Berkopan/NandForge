import { CircuitBuilder } from './builder';
import type { ChipDefinition, Component, ComponentType, Endpoint, PortBinding } from './types';

const composites = new Set<ComponentType>([
  'NOT', 'AND', 'OR', 'NOR', 'XOR', 'XNOR', 'BUFFER', 'MUX', 'DEMUX', 'DECODER',
  'HALF_ADDER', 'FULL_ADDER', 'ADDER', 'SUBTRACTOR', 'COMPARATOR', 'REGISTER', 'COUNTER',
]);
const cache = new Map<string, ChipDefinition>();

/** Internal immutable-by-convention blueprints. Public inspection returns a detached copy. */
export function buildBuiltinChip(component: Component): ChipDefinition | undefined {
  if (!composites.has(component.type)) return undefined;
  const type = component.type;
  const width = component.config.width ?? 1;
  const initial = component.config.initial ?? 0;
  if (!Number.isInteger(width) || width < 1 || width > 16 || (type === 'DECODER' && width > 8)) return undefined;
  const id = `builtin:${type.toLowerCase()}:${width}:${type === 'REGISTER' || type === 'COUNTER' ? initial : 0}`;
  const cached = cache.get(id);
  if (cached) return cached;

  const builder = new CircuitBuilder(id, `${type.replaceAll('_', ' ')} · ${width} bit`);
  const inputs: PortBinding[] = [];
  const outputs: PortBinding[] = [];
  const input = (name: string, bits = width): Endpoint => {
    const from = builder.input(name, bits);
    inputs.push({ name, width: bits, nodeId: from.node });
    return from;
  };
  const output = (name: string, from: Endpoint, bits = width): void => {
    const to = builder.output(name, bits, from);
    outputs.push({ name, width: bits, nodeId: to.node });
  };
  const nand = (a: Endpoint, b: Endpoint, bits = width) => builder.gate('NAND', { a, b }, bits);
  const not = (value: Endpoint, bits = width) => nand(value, value, bits);
  const and = (a: Endpoint, b: Endpoint, bits = width) => not(nand(a, b, bits), bits);
  const or = (a: Endpoint, b: Endpoint, bits = width) => nand(not(a, bits), not(b, bits), bits);
  const xor = (a: Endpoint, b: Endpoint, bits = width) => {
    const common = nand(a, b, bits);
    return nand(nand(a, common, bits), nand(b, common, bits), bits);
  };
  const split = (value: Endpoint, bits = width): Endpoint[] => {
    if (bits === 1) return [value];
    const node = builder.gate('SPLIT', { in: value }, bits).node;
    return Array.from({ length: bits }, (_, bit) => ({ node, pin: `b${bit}` }));
  };
  const join = (bits: readonly Endpoint[]): Endpoint => {
    if (bits.length === 1) return bits[0]!;
    return builder.gate('JOIN', Object.fromEntries(bits.map((from, bit) => [`b${bit}`, from])), bits.length);
  };
  const spread = (bit: Endpoint): Endpoint => join(Array.from({ length: width }, () => bit));
  const mux = (a: Endpoint, b: Endpoint, select: Endpoint) => {
    const selectBus = spread(select);
    return nand(nand(a, not(selectBus)), nand(b, selectBus));
  };

  switch (type) {
    case 'NOT': output('out', not(input('in'))); break;
    case 'BUFFER': output('out', not(not(input('in')))); break;
    case 'AND': output('out', and(input('a'), input('b'))); break;
    case 'OR': output('out', or(input('a'), input('b'))); break;
    case 'NOR': output('out', not(or(input('a'), input('b')))); break;
    case 'XOR': output('out', xor(input('a'), input('b'))); break;
    case 'XNOR': output('out', not(xor(input('a'), input('b')))); break;
    case 'MUX': output('out', mux(input('a'), input('b'), input('sel', 1))); break;
    case 'DEMUX': {
      const value = input('in');
      const select = spread(input('sel', 1));
      output('a', and(value, not(select)));
      output('b', and(value, select));
      break;
    }
    case 'DECODER': {
      const bits = split(input('in'));
      const inverse = bits.map(bit => not(bit, 1));
      for (let address = 0; address < 2 ** width; address++) {
        const terms = bits.map((bit, index) => (address >> index) & 1 ? bit : inverse[index]!);
        let result = terms[0]!;
        for (const term of terms.slice(1)) result = and(result, term, 1);
        output(`o${address}`, result, 1);
      }
      break;
    }
    case 'HALF_ADDER': {
      const a = input('a', 1);
      const b = input('b', 1);
      output('sum', xor(a, b, 1), 1);
      output('carry', and(a, b, 1), 1);
      break;
    }
    case 'FULL_ADDER': {
      const a = input('a', 1);
      const b = input('b', 1);
      const cin = input('cin', 1);
      const ab = nand(a, b, 1);
      const x = nand(nand(a, ab, 1), nand(b, ab, 1), 1);
      const xc = nand(x, cin, 1);
      output('sum', nand(nand(x, xc, 1), nand(cin, xc, 1), 1), 1);
      output('cout', nand(ab, xc, 1), 1);
      break;
    }
    case 'ADDER': {
      const a = split(input('a'));
      const b = split(input('b'));
      let carry = input('cin', 1);
      const sums: Endpoint[] = [];
      for (let bit = 0; bit < width; bit++) {
        const node = builder.gate('FULL_ADDER', { a: a[bit]!, b: b[bit]!, cin: carry }, 1).node;
        sums.push({ node, pin: 'sum' });
        carry = { node, pin: 'cout' };
      }
      output('sum', join(sums));
      output('cout', carry, 1);
      break;
    }
    case 'SUBTRACTOR': {
      const a = input('a');
      const b = not(input('b'));
      const cin = not(input('cin', 1), 1);
      const node = builder.gate('ADDER', { a, b, cin }, width).node;
      output('sum', { node, pin: 'sum' });
      output('cout', not({ node, pin: 'cout' }, 1), 1);
      break;
    }
    case 'COMPARATOR': {
      const a = input('a');
      const b = input('b');
      const different = split(xor(a, b));
      let anyDifferent = different[0]!;
      for (const bit of different.slice(1)) anyDifferent = or(anyDifferent, bit, 1);
      const eq = not(anyDifferent, 1);
      const subtraction = builder.gate('SUBTRACTOR', { a, b, cin: builder.constant(0) }, width).node;
      const lt = { node: subtraction, pin: 'cout' };
      output('eq', eq, 1);
      output('lt', lt, 1);
      output('gt', not(or(eq, lt, 1), 1), 1);
      break;
    }
    case 'REGISTER': {
      const d = input('d');
      const clk = input('clk', 1);
      const en = input('en', 1);
      const state = builder.gate('DFF', { clk }, width, { initial }).node;
      const q = { node: state, pin: 'q' };
      builder.wire(mux(q, d, en), { node: state, pin: 'd' });
      output('q', q);
      break;
    }
    case 'COUNTER': {
      const clk = input('clk', 1);
      const en = input('en', 1);
      const reset = input('reset', 1);
      const state = builder.gate('DFF', { clk }, width, { initial }).node;
      const q = { node: state, pin: 'q' };
      const adder = builder.gate('ADDER', { a: q, b: builder.constant(1, width), cin: builder.constant(0) }, width).node;
      const incremented = { node: adder, pin: 'sum' };
      const next = mux(mux(q, incremented, en), builder.constant(0, width), reset);
      builder.wire(next, { node: state, pin: 'd' });
      output('q', q);
      break;
    }
    default: return undefined;
  }

  const definition: ChipDefinition = {
    id, name: builder.circuit.name, description: 'Inspectable NAND-derived digital logic. SPLIT/JOIN are wiring; DFF is an idealized state boundary.',
    version: 1, inputs, outputs, circuit: builder.layout(),
  };
  if (cache.size >= 256) cache.delete(cache.keys().next().value ?? '');
  cache.set(id, definition);
  return definition;
}
