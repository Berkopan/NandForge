import { CircuitBuilder } from './builder';
import { getComponentSpec } from './catalog';
import type { Circuit, ComponentConfig, ComponentType } from './types';

export interface CircuitTemplate { id: string; name: string; description: string }
export const TEMPLATES: readonly CircuitTemplate[] = [
  { id: 'and', name: 'Your first AND gate', description: 'Two inputs, one output, and an inspectable two-NAND implementation.' },
  { id: 'nand-xor', name: 'XOR from four NANDs', description: 'The complete four-gate XOR construction, with every connection exposed.' },
  { id: 'half-adder', name: 'Half adder', description: 'Add two bits and inspect the independent sum and carry outputs.' },
  { id: 'full-adder', name: 'Full adder', description: 'Carry-in joins two operand bits in a nine-NAND adder.' },
  { id: 'adder8', name: '8-bit ripple adder', description: 'Start with 3 + 4, then explore carry and 8-bit wraparound.' },
  { id: 'subtractor8', name: '8-bit subtractor', description: 'Explore two’s-complement subtraction and the explicit borrow-out flag.' },
  { id: 'mux8', name: '8-bit multiplexer', description: 'A one-bit selector chooses between two independent 8-bit buses.' },
  { id: 'register8', name: 'Clocked register', description: 'Input changes immediately; the stored output only changes at an enabled rising edge.' },
  { id: 'counter8', name: '8-bit counter', description: 'A real adder and register increment each clock; reset has priority over enable.' },
  { id: 'memory', name: 'Read and write RAM', description: 'Try asynchronous reads and synchronous writes in a 16-word memory.' },
  { id: 'decoder', name: '2-to-4 decoder', description: 'Translate a two-bit bus into four mutually exclusive single-bit outputs.' },
  { id: 'comparator', name: '4-bit comparator', description: 'Compare unsigned words and observe equal, less-than, and greater-than signals.' },
  { id: 'bus', name: 'Split and join a bus', description: 'Inspect least-significant-bit ordering and reconstruct an 8-bit word.' },
] as const;

function gateTemplate(id: string, type: ComponentType, config: ComponentConfig, values: Readonly<Record<string, number>> = {}): Circuit {
  const entry = TEMPLATES.find(template => template.id === id);
  const builder = new CircuitBuilder(`template-${id}`, entry?.name ?? id, entry?.description);
  const gate = builder.add(type, 'gate', config);
  const spec = getComponentSpec(gate);
  for (const pin of spec.inputs) {
    const node = pin.name === 'clk' ? builder.add('CLOCK', 'clock', { width: 1 }, 'CLK').id : builder.input(pin.name, pin.width, values[pin.name] ?? 0).node;
    builder.wire({ node, pin: 'out' }, { node: gate.id, pin: pin.name });
  }
  for (const pin of spec.outputs) builder.output(pin.name, pin.width, { node: gate.id, pin: pin.name });
  return builder.layout();
}

export function createTemplate(id: string): Circuit {
  switch (id) {
    case 'empty': case 'blank': return { id: 'untitled', name: 'Untitled circuit', version: 1, components: [], connections: [] };
    case 'nand': return gateTemplate(id, 'NAND', { width: 1 });
    case 'not': return gateTemplate(id, 'NOT', { width: 1 });
    case 'and': return gateTemplate(id, 'AND', { width: 1 });
    case 'xor': return gateTemplate(id, 'XOR', { width: 1 });
    case 'half-adder': return gateTemplate(id, 'HALF_ADDER', { width: 1 });
    case 'full-adder': return gateTemplate(id, 'FULL_ADDER', { width: 1 });
    case 'adder': case 'adder8': return gateTemplate('adder8', 'ADDER', { width: 8 }, { a: 3, b: 4 });
    case 'subtractor': case 'subtractor8': return gateTemplate('subtractor8', 'SUBTRACTOR', { width: 8 }, { a: 7, b: 4 });
    case 'mux': case 'mux8': return gateTemplate('mux8', 'MUX', { width: 8 }, { a: 42, b: 165 });
    case 'register': case 'register8': return gateTemplate('register8', 'REGISTER', { width: 8 }, { d: 42, en: 1 });
    case 'counter': case 'counter8': return gateTemplate('counter8', 'COUNTER', { width: 8 }, { en: 1 });
    case 'ram': case 'memory': return gateTemplate('memory', 'RAM', { width: 8, addressWidth: 4, contents: [3, 5, 8, 13, 21] }, { d: 42 });
    case 'decoder': return gateTemplate(id, 'DECODER', { width: 2 });
    case 'comparator': return gateTemplate(id, 'COMPARATOR', { width: 4 }, { a: 3, b: 7 });
    case 'nand-xor': {
      const builder = new CircuitBuilder('template-nand-xor', 'XOR from four NANDs', TEMPLATES.find(template => template.id === id)!.description);
      const a = builder.input('a');
      const b = builder.input('b');
      const common = builder.gate('NAND', { a, b });
      const left = builder.gate('NAND', { a, b: common });
      const right = builder.gate('NAND', { a: b, b: common });
      builder.output('out', 1, builder.gate('NAND', { a: left, b: right }));
      return builder.layout();
    }
    case 'bus': {
      const builder = new CircuitBuilder('template-bus', 'Split and join a bus');
      const source = builder.input('word', 8, 165);
      const split = builder.gate('SPLIT', { in: source }, 8).node;
      const bits = Object.fromEntries(Array.from({ length: 8 }, (_, bit) => [`b${bit}`, { node: split, pin: `b${bit}` }]));
      builder.output('word', 8, builder.gate('JOIN', bits, 8));
      for (let bit = 0; bit < 8; bit++) builder.output(`bit${bit}`, 1, { node: split, pin: `b${bit}` });
      return builder.layout();
    }
    default: throw new RangeError(`Unknown circuit template “${id}”.`);
  }
}
