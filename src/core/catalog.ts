import { buildBuiltinChip } from './chips';
import type { ChipDefinition, Component, ComponentConfig, ComponentSpec, ComponentType, Position } from './types';

export interface CatalogEntry { type: ComponentType; label: string; category: string; description: string }

export const COMPONENT_CATALOG: readonly CatalogEntry[] = [
  { type: 'INPUT', label: 'Input', category: 'Inputs & outputs', description: 'A user-controlled unsigned bus. Choose switch or momentary button in the inspector.' },
  { type: 'OUTPUT', label: 'Output', category: 'Inputs & outputs', description: 'Observe a signal as an LED, binary, hexadecimal, or seven-segment display.' },
  { type: 'CONST', label: 'Constant', category: 'Inputs & outputs', description: 'An unsigned constant with an explicit bus width.' },
  { type: 'CLOCK', label: 'Clock', category: 'Inputs & outputs', description: 'One clock step emits a low–high–low pulse. Rising edges commit state atomically.' },
  { type: 'NAND', label: 'NAND', category: 'Basic gates', description: 'Primitive bitwise NOT-AND. Each output bit is zero only when both corresponding input bits are one.' },
  { type: 'NOT', label: 'NOT', category: 'Basic gates', description: 'Bitwise inversion built by connecting both NAND inputs to the same signal.' },
  { type: 'AND', label: 'AND', category: 'Basic gates', description: 'Bitwise conjunction built from two NAND stages.' },
  { type: 'OR', label: 'OR', category: 'Basic gates', description: 'Bitwise inclusive OR built from three NAND stages using De Morgan’s law.' },
  { type: 'NOR', label: 'NOR', category: 'Basic gates', description: 'Bitwise inverted OR, synthesized entirely from NAND gates.' },
  { type: 'XOR', label: 'XOR', category: 'Basic gates', description: 'Bitwise exclusive OR built from four NAND gates per bit.' },
  { type: 'XNOR', label: 'XNOR', category: 'Basic gates', description: 'Bitwise equality, built from XOR and NAND inversion.' },
  { type: 'BUFFER', label: 'Buffer', category: 'Basic gates', description: 'Two NAND inversions preserve the input signal.' },
  { type: 'HALF_ADDER', label: 'Half adder', category: 'Arithmetic', description: 'Add two single bits to produce a sum and carry.' },
  { type: 'FULL_ADDER', label: 'Full adder', category: 'Arithmetic', description: 'Add a, b, and carry-in with a nine-NAND single-bit implementation.' },
  { type: 'ADDER', label: 'Ripple-carry adder', category: 'Arithmetic', description: 'Unsigned a + b + cin. Sum wraps to the bus width; cout reports carry. Unconnected cin explicitly defaults to zero.' },
  { type: 'SUBTRACTOR', label: 'Subtractor', category: 'Arithmetic', description: 'Unsigned a − b − cin. Here cin means borrow-in and cout means borrow-out. Unconnected cin explicitly defaults to zero.' },
  { type: 'COMPARATOR', label: 'Comparator', category: 'Arithmetic', description: 'Unsigned comparison with mutually exclusive eq, lt, and gt outputs.' },
  { type: 'MUX', label: 'Multiplexer', category: 'Routing', description: 'Select a when sel=0 or b when sel=1. The select pin is always one bit.' },
  { type: 'DEMUX', label: 'Demultiplexer', category: 'Routing', description: 'Route the input bus to a when sel=0 or b when sel=1; the other output is zero.' },
  { type: 'DECODER', label: 'Decoder', category: 'Routing', description: 'Decode a 1–8-bit unsigned input into one active output, o0 through o(2^width−1).' },
  { type: 'SPLIT', label: 'Bus splitter', category: 'Routing', description: 'Extract b0 (least significant bit) through b(width−1) from a bus.' },
  { type: 'JOIN', label: 'Bus joiner', category: 'Routing', description: 'Compose a bus from individual bits. b0 is the least significant bit.' },
  { type: 'DFF', label: 'D flip-flop', category: 'Sequential', description: 'Idealized positive-edge state primitive. All flip-flops sample the same stable pre-edge circuit state.' },
  { type: 'REGISTER', label: 'Register', category: 'Sequential', description: 'A NAND multiplexer and D flip-flop. en=1 loads d at the rising edge; en=0 retains q.' },
  { type: 'COUNTER', label: 'Counter', category: 'Sequential', description: 'A register, ripple adder, and multiplexers. en increments; synchronous reset has priority.' },
  { type: 'RAM', label: 'RAM', category: 'Memory', description: 'Idealized asynchronous read memory with synchronous rising-edge writes. we=1 writes d to addr.' },
  { type: 'ROM', label: 'ROM', category: 'Memory', description: 'Idealized read-only memory with a combinational addr → out path. Program contents are editable while paused.' },
] as const;

const catalog = new Map<ComponentType, CatalogEntry>(COMPONENT_CATALOG.map(entry => [entry.type, entry]));

export function createComponent(type: ComponentType, id: string, position: Position = { x: 100, y: 100 }, config: ComponentConfig = {}): Component {
  return { id, type, position: { ...position }, config: { width: 1, ...config } };
}

export function getComponentSpec(component: Component, chips: readonly ChipDefinition[] = []): ComponentSpec {
  const width = component.config?.width ?? 1;
  const addressWidth = component.config?.addressWidth ?? 8;
  const pin = (name: string, bits = width) => ({ name, width: bits });
  if (component.type === 'CHIP') {
    const chip = chips.find(item => item.id === component.config?.chipId);
    return {
      label: chip?.name ?? 'Missing chip', category: 'Custom', description: chip?.description ?? 'Choose an existing chip definition.',
      inputs: chip?.inputs.map(({ name, width: bits }) => pin(name, bits)) ?? [],
      outputs: chip?.outputs.map(({ name, width: bits }) => pin(name, bits)) ?? [],
    };
  }
  const entry = catalog.get(component.type);
  if (!entry) throw new Error(`Unsupported component type: ${String(component.type)}`);
  const base = { label: entry.label, category: entry.category, description: entry.description };
  switch (component.type) {
    case 'INPUT': case 'CONST': return { ...base, inputs: [], outputs: [pin('out')] };
    case 'CLOCK': return { ...base, inputs: [], outputs: [pin('out', 1)] };
    case 'OUTPUT': return { ...base, inputs: [pin('in')], outputs: [] };
    case 'NOT': case 'BUFFER': return { ...base, inputs: [pin('in')], outputs: [pin('out')] };
    case 'NAND': case 'AND': case 'OR': case 'NOR': case 'XOR': case 'XNOR':
      return { ...base, inputs: [pin('a'), pin('b')], outputs: [pin('out')] };
    case 'HALF_ADDER': return { ...base, inputs: [pin('a', 1), pin('b', 1)], outputs: [pin('sum', 1), pin('carry', 1)] };
    case 'FULL_ADDER': return { ...base, inputs: [pin('a', 1), pin('b', 1), pin('cin', 1)], outputs: [pin('sum', 1), pin('cout', 1)] };
    case 'ADDER': case 'SUBTRACTOR':
      return { ...base, inputs: [pin('a'), pin('b'), { ...pin('cin', 1), optional: true, defaultValue: 0 }], outputs: [pin('sum'), pin('cout', 1)] };
    case 'COMPARATOR': return { ...base, inputs: [pin('a'), pin('b')], outputs: [pin('eq', 1), pin('lt', 1), pin('gt', 1)] };
    case 'MUX': return { ...base, inputs: [pin('a'), pin('b'), pin('sel', 1)], outputs: [pin('out')] };
    case 'DEMUX': return { ...base, inputs: [pin('in'), pin('sel', 1)], outputs: [pin('a'), pin('b')] };
    case 'DECODER': return { ...base, inputs: [pin('in')], outputs: Array.from({ length: 1 << Math.min(Math.max(width, 1), 8) }, (_, bit) => pin(`o${bit}`, 1)) };
    case 'DFF': return { ...base, inputs: [pin('d'), pin('clk', 1)], outputs: [pin('q')] };
    case 'REGISTER': return { ...base, inputs: [pin('d'), pin('clk', 1), pin('en', 1)], outputs: [pin('q')] };
    case 'COUNTER': return { ...base, inputs: [pin('clk', 1), pin('en', 1), pin('reset', 1)], outputs: [pin('q')] };
    case 'RAM': return { ...base, inputs: [pin('addr', addressWidth), pin('d'), pin('we', 1), pin('clk', 1)], outputs: [pin('out')] };
    case 'ROM': return { ...base, inputs: [pin('addr', addressWidth)], outputs: [pin('out')] };
    case 'SPLIT': return { ...base, inputs: [pin('in')], outputs: Array.from({ length: Math.min(Math.max(width, 1), 16) }, (_, bit) => pin(`b${bit}`, 1)) };
    case 'JOIN': return { ...base, inputs: Array.from({ length: Math.min(Math.max(width, 1), 16) }, (_, bit) => pin(`b${bit}`, 1)), outputs: [pin('out')] };
  }
}

export function getChipForComponent(component: Component, chips: readonly ChipDefinition[] = []): ChipDefinition | undefined {
  if (component.type === 'CHIP') return chips.find(chip => chip.id === component.config.chipId);
  const chip = buildBuiltinChip(component);
  return chip ? structuredClone(chip) : undefined;
}
