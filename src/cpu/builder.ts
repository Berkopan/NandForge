import type { ChipDefinition, Circuit, ComponentConfig, ComponentType, Endpoint } from '../core/types';

/** Elaboration-only helpers. Every operation becomes a visible circuit component. */
export class CircuitBuilder {
  readonly circuit: Circuit;
  private serial = 0;

  constructor(id: string, name: string, description = '') {
    this.circuit = { id, name, description, version: 1, components: [], connections: [] };
  }

  component(type: ComponentType, id: string, config: ComponentConfig = {}, label = id): string {
    const index = this.circuit.components.length;
    this.circuit.components.push({
      id, type, label, config,
      position: { x: (index % 5) * 240, y: Math.floor(index / 5) * 170 },
    });
    return id;
  }

  ref(node: string, pin = 'out'): Endpoint { return { node, pin }; }

  wire(from: Endpoint, node: string, pin: string): void {
    this.circuit.connections.push({ id: `w${++this.serial}`, from, to: { node, pin } });
  }

  input(id: string, width = 1): Endpoint {
    return this.ref(this.component('INPUT', id, { width }));
  }

  constant(value: number, width = 1, name?: string): Endpoint {
    return this.ref(this.component('CONST', name ?? `constant-${++this.serial}`, { value, width }));
  }

  output(id: string, from: Endpoint, width = 1): void {
    this.component('OUTPUT', id, { width });
    this.wire(from, id, 'in');
  }

  unary(type: 'NOT' | 'BUFFER', input: Endpoint, width = 1, name?: string): Endpoint {
    const id = this.component(type, name ?? `${type.toLowerCase()}-${++this.serial}`, { width });
    this.wire(input, id, 'in');
    return this.ref(id);
  }

  binary(type: 'AND' | 'OR' | 'XOR' | 'NAND', a: Endpoint, b: Endpoint, width = 1, name?: string): Endpoint {
    const id = this.component(type, name ?? `${type.toLowerCase()}-${++this.serial}`, { width });
    this.wire(a, id, 'a');
    this.wire(b, id, 'b');
    return this.ref(id);
  }

  reduce(type: 'AND' | 'OR', inputs: Endpoint[], name = type.toLowerCase()): Endpoint {
    if (inputs.length === 0) return this.constant(type === 'AND' ? 1 : 0);
    let level = inputs;
    let depth = 0;
    while (level.length > 1) {
      const next: Endpoint[] = [];
      for (let i = 0; i < level.length; i += 2) {
        next.push(i + 1 < level.length
          ? this.binary(type, level[i]!, level[i + 1]!, 1, `${name}-${depth}-${i / 2}`)
          : level[i]!);
      }
      level = next;
      depth += 1;
    }
    return level[0]!;
  }

  mux(a: Endpoint, b: Endpoint, sel: Endpoint, width = 1, name?: string): Endpoint {
    const id = this.component('MUX', name ?? `mux-${++this.serial}`, { width });
    this.wire(a, id, 'a');
    this.wire(b, id, 'b');
    this.wire(sel, id, 'sel');
    return this.ref(id);
  }

  split(input: Endpoint, width: number, name?: string): Endpoint[] {
    const id = this.component('SPLIT', name ?? `split-${++this.serial}`, { width });
    this.wire(input, id, 'in');
    return Array.from({ length: width }, (_, bit) => this.ref(id, `b${bit}`));
  }

  join(bits: Endpoint[], name?: string): Endpoint {
    const id = this.component('JOIN', name ?? `join-${++this.serial}`, { width: bits.length });
    bits.forEach((bit, i) => this.wire(bit, id, `b${i}`));
    return this.ref(id);
  }

  adder(a: Endpoint, b: Endpoint, cin: Endpoint, width: number, name: string): { sum: Endpoint; carry: Endpoint } {
    const id = this.component('ADDER', name, { width });
    this.wire(a, id, 'a');
    this.wire(b, id, 'b');
    this.wire(cin, id, 'cin');
    return { sum: this.ref(id, 'sum'), carry: this.ref(id, 'cout') };
  }

  register(id: string, d: Endpoint, clk: Endpoint, en: Endpoint, width: number, initial = 0): Endpoint {
    this.component('REGISTER', id, { width, initial });
    this.wire(d, id, 'd');
    this.wire(clk, id, 'clk');
    this.wire(en, id, 'en');
    return this.ref(id, 'q');
  }

  chip(id: string, definition: ChipDefinition, inputs: Record<string, Endpoint>, label = definition.name): string {
    this.component('CHIP', id, { chipId: definition.id }, label);
    for (const [pin, source] of Object.entries(inputs)) this.wire(source, id, pin);
    return id;
  }

  definition(description: string): ChipDefinition {
    return {
      id: this.circuit.id, name: this.circuit.name, description, version: 1,
      inputs: this.circuit.components.filter((c) => c.type === 'INPUT').map((c) => ({
        name: c.id, width: c.config.width ?? 1, nodeId: c.id,
      })),
      outputs: this.circuit.components.filter((c) => c.type === 'OUTPUT').map((c) => ({
        name: c.id, width: c.config.width ?? 1, nodeId: c.id,
      })),
      circuit: this.circuit,
    };
  }
}
