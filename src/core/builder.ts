import type { Circuit, Component, ComponentConfig, ComponentType, Endpoint } from './types';

/** Small, deterministic netlist authoring helper. It performs no simulation. */
export class CircuitBuilder {
  readonly circuit: Circuit;
  private serial = 0;

  constructor(id: string, name: string, description = '') {
    this.circuit = { id, name, description, version: 1, components: [], connections: [] };
  }

  add(type: ComponentType, id: string, config: ComponentConfig = {}, label?: string): Component {
    const component: Component = { id, type, config: { ...config }, label, position: { x: 0, y: 0 } };
    this.circuit.components.push(component);
    return component;
  }

  input(name: string, width = 1, value = 0): Endpoint {
    const id = `in-${name}`;
    this.add('INPUT', id, { width, value }, name);
    return { node: id, pin: 'out' };
  }

  output(name: string, width: number, from: Endpoint): Endpoint {
    const id = `out-${name}`;
    this.add('OUTPUT', id, { width }, name);
    this.wire(from, { node: id, pin: 'in' });
    return { node: id, pin: 'in' };
  }

  constant(value: number, width = 1): Endpoint {
    const id = `const-${this.serial++}`;
    this.add('CONST', id, { width, value });
    return { node: id, pin: 'out' };
  }

  gate(type: ComponentType, inputs: Readonly<Record<string, Endpoint>>, width = 1, config: ComponentConfig = {}): Endpoint {
    const id = `${type.toLowerCase()}-${this.serial++}`;
    this.add(type, id, { width, ...config });
    for (const [pin, from] of Object.entries(inputs)) this.wire(from, { node: id, pin });
    return { node: id, pin: 'out' };
  }

  wire(from: Endpoint, to: Endpoint): void {
    this.circuit.connections.push({ id: `wire-${this.circuit.connections.length}`, from: { ...from }, to: { ...to } });
  }

  /** Put acyclic logic in columns; feedback terminates at idealized state elements. */
  layout(): Circuit {
    const layers = new Map<string, number>();
    const incoming = new Map<string, string[]>();
    const byId = new Map(this.circuit.components.map(component => [component.id, component]));
    for (const wire of this.circuit.connections) {
      const list = incoming.get(wire.to.node) ?? [];
      list.push(wire.from.node);
      incoming.set(wire.to.node, list);
    }
    const active = new Set<string>();
    const layer = (id: string): number => {
      const cached = layers.get(id);
      if (cached !== undefined) return cached;
      if (active.has(id)) return 0;
      active.add(id);
      const type = byId.get(id)?.type;
      const sources = type === 'DFF' || type === 'RAM' ? [] : incoming.get(id) ?? [];
      const result = sources.length ? Math.max(...sources.map(layer)) + 1 : 0;
      active.delete(id);
      layers.set(id, result);
      return result;
    };
    const rows = new Map<number, number>();
    for (const component of this.circuit.components) {
      const column = layer(component.id);
      const row = rows.get(column) ?? 0;
      rows.set(column, row + 1);
      component.position = { x: 70 + column * 210, y: 70 + row * 170 };
    }
    return this.circuit;
  }
}
