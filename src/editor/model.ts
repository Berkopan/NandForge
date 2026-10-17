import { createComponent, getComponentSpec, validateCircuit, type Simulator } from '../core';
import type { ChipDefinition, Circuit, Component, Connection, Endpoint, Position } from '../core/types';

let sequence = 0;
export function editorId(prefix = 'node'): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export interface CircuitFragment {
  components: Component[];
  connections: Connection[];
}

export function copySelection(circuit: Circuit, ids: ReadonlySet<string>): CircuitFragment {
  return structuredClone({
    components: circuit.components.filter(component => ids.has(component.id)),
    connections: circuit.connections.filter(wire => ids.has(wire.from.node) && ids.has(wire.to.node)),
  });
}

export function pasteFragment(
  circuit: Circuit,
  fragment: CircuitFragment,
  offset: Position = { x: 40, y: 40 },
  makeId: (prefix?: string) => string = editorId,
): { circuit: Circuit; ids: Set<string> } {
  const idMap = new Map(fragment.components.map(component => [component.id, makeId('node')]));
  const components = fragment.components.map(component => ({
    ...structuredClone(component),
    id: idMap.get(component.id)!,
    position: { x: component.position.x + offset.x, y: component.position.y + offset.y },
  }));
  const connections = fragment.connections.flatMap(wire => {
    const source = idMap.get(wire.from.node);
    const target = idMap.get(wire.to.node);
    return source && target ? [{ id: makeId('wire'), from: { node: source, pin: wire.from.pin }, to: { node: target, pin: wire.to.pin } }] : [];
  });
  return {
    circuit: { ...circuit, components: [...circuit.components, ...components], connections: [...circuit.connections, ...connections] },
    ids: new Set(components.map(component => component.id)),
  };
}

export function deleteSelection(circuit: Circuit, nodeIds: ReadonlySet<string>, wireIds: ReadonlySet<string>): Circuit {
  return {
    ...circuit,
    components: circuit.components.filter(component => !nodeIds.has(component.id)),
    connections: circuit.connections.filter(wire => !wireIds.has(wire.id) && !nodeIds.has(wire.from.node) && !nodeIds.has(wire.to.node)),
  };
}

export type ConnectionProblem = 'invalidPin' | 'mismatchedWidth' | 'alreadyDriven';

export function connectionProblem(circuit: Circuit, from: Endpoint, to: Endpoint, chips: ChipDefinition[] = []): ConnectionProblem | null {
  const source = circuit.components.find(component => component.id === from.node);
  const target = circuit.components.find(component => component.id === to.node);
  if (!source || !target) return 'invalidPin';
  try {
    const output = getComponentSpec(source, chips).outputs.find(pin => pin.name === from.pin);
    const input = getComponentSpec(target, chips).inputs.find(pin => pin.name === to.pin);
    if (!output || !input) return 'invalidPin';
    if (output.width !== input.width) return 'mismatchedWidth';
    if (circuit.connections.some(wire => wire.to.node === to.node && wire.to.pin === to.pin)) return 'alreadyDriven';
    return null;
  } catch {
    return 'invalidPin';
  }
}

export function replaceInputConnection(circuit: Circuit, to: Endpoint, from: Endpoint | null, chips: ChipDefinition[] = []): Circuit {
  const disconnected = { ...circuit, connections: circuit.connections.filter(wire => wire.to.node !== to.node || wire.to.pin !== to.pin) };
  if (!from) return disconnected;
  const problem = connectionProblem(disconnected, from, to, chips);
  if (problem) throw new Error(problem);
  return { ...disconnected, connections: [...disconnected.connections, { id: editorId('wire'), from, to }] };
}

/** Build a real module, introducing typed INPUT/OUTPUT nodes at selection boundaries. */
export function createChipFromCircuit(
  circuit: Circuit,
  selectedIds: ReadonlySet<string> | null,
  name: string,
  description: string,
  chips: ChipDefinition[] = [],
): ChipDefinition {
  const ids = selectedIds && selectedIds.size > 0 ? selectedIds : new Set(circuit.components.map(component => component.id));
  const fragment = copySelection(circuit, ids);
  const id = editorId('chip');
  const internal: Circuit = { id: `${id}-circuit`, name: name.trim(), description: description.trim(), version: 1, ...fragment };
  const names = new Set<string>();
  const uniqueName = (suggestion: string) => {
    const stem = suggestion.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'port';
    let value = stem;
    let index = 2;
    while (names.has(value)) value = `${stem}_${index++}`;
    names.add(value);
    return value;
  };
  const inputs = internal.components.filter(component => component.type === 'INPUT').map(component => ({
    name: uniqueName(component.label || component.id), width: component.config.width ?? 1, nodeId: component.id,
  }));
  const outputs = internal.components.filter(component => component.type === 'OUTPUT').map(component => ({
    name: uniqueName(component.label || component.id), width: component.config.width ?? 1, nodeId: component.id,
  }));
  const inbound = new Map<string, { portId: string }>();
  const outbound = new Set<string>();
  for (const wire of circuit.connections) {
    const sourceInside = ids.has(wire.from.node);
    const targetInside = ids.has(wire.to.node);
    if (!sourceInside && targetInside) {
      const source = circuit.components.find(component => component.id === wire.from.node)!;
      const target = circuit.components.find(component => component.id === wire.to.node)!;
      const width = getComponentSpec(target, chips).inputs.find(pin => pin.name === wire.to.pin)?.width;
      if (!width) throw new Error('invalidPin');
      const key = JSON.stringify([wire.from.node, wire.from.pin]);
      let binding = inbound.get(key);
      if (!binding) {
        const portId = editorId('in');
        const portName = uniqueName(source.label || `${target.label || target.type}_${wire.to.pin}`);
        internal.components.push({ ...createComponent('INPUT', portId, { x: target.position.x - 240, y: target.position.y + inbound.size * 90 }, { width }), label: portName });
        inputs.push({ name: portName, width, nodeId: portId });
        binding = { portId };
        inbound.set(key, binding);
      }
      internal.connections.push({ id: editorId('wire'), from: { node: binding.portId, pin: 'out' }, to: { ...wire.to } });
    } else if (sourceInside && !targetInside) {
      const key = JSON.stringify([wire.from.node, wire.from.pin]);
      if (outbound.has(key)) continue;
      outbound.add(key);
      const source = circuit.components.find(component => component.id === wire.from.node)!;
      if (internal.connections.some(connection => connection.from.node === wire.from.node && connection.from.pin === wire.from.pin && internal.components.some(component => component.id === connection.to.node && component.type === 'OUTPUT'))) continue;
      const width = getComponentSpec(source, chips).outputs.find(pin => pin.name === wire.from.pin)?.width;
      if (!width) throw new Error('invalidPin');
      const portId = editorId('out');
      const portName = uniqueName(`${source.label || source.type}_${wire.from.pin}`);
      internal.components.push({ ...createComponent('OUTPUT', portId, { x: source.position.x + 240, y: source.position.y + outbound.size * 90 }, { width }), label: portName });
      internal.connections.push({ id: editorId('wire'), from: { ...wire.from }, to: { node: portId, pin: 'in' } });
      outputs.push({ name: portName, width, nodeId: portId });
    }
  }
  if (outputs.length === 0) throw new Error('chipNeedsPorts');
  if (validateCircuit(internal, chips).some(diagnostic => diagnostic.severity === 'error')) throw new Error('chipInvalid');
  return { id, name: name.trim(), description: description.trim(), version: 1, inputs, outputs, circuit: internal };
}

/** Deterministic layered layout, with a feedback-safe cap and pin-count-aware vertical spacing. */
export function arrangeCircuit(circuit: Circuit, chips: ChipDefinition[] = []): Circuit {
  const ids = new Set(circuit.components.map(component => component.id));
  const components = new Map(circuit.components.map(component => [component.id, component]));
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const inbound = new Map<string, string[]>();
  for (const wire of circuit.connections) {
    if (ids.has(wire.from.node) && ids.has(wire.to.node)) inbound.set(wire.to.node, [...(inbound.get(wire.to.node) ?? []), wire.from.node]);
  }
  const getRank = (id: string): number => {
    const existing = rank.get(id);
    if (existing !== undefined) return existing;
    if (visiting.has(id)) return 0;
    const component = components.get(id)!;
    if (['INPUT', 'CONST', 'CLOCK', 'DFF', 'REGISTER', 'RAM'].includes(component.type)) {
      rank.set(id, 0);
      return 0;
    }
    visiting.add(id);
    const dependencies = inbound.get(id) ?? [];
    const result = dependencies.length ? Math.min(80, Math.max(...dependencies.map(getRank)) + 1) : 0;
    visiting.delete(id);
    rank.set(id, result);
    return result;
  };
  const columns = new Map<number, Component[]>();
  for (const component of circuit.components) {
    const column = getRank(component.id);
    columns.set(column, [...(columns.get(column) ?? []), component]);
  }
  const positions = new Map<string, Position>();
  for (const [column, members] of columns) {
    let y = 80;
    for (const component of members.sort((a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id))) {
      positions.set(component.id, { x: 80 + column * 280, y });
      try {
        const spec = getComponentSpec(component, chips);
        y += Math.max(180, Math.max(spec.inputs.length, spec.outputs.length) * 23 + 105);
      } catch {
        y += 180;
      }
    }
  }
  return { ...circuit, components: circuit.components.map(component => ({ ...component, position: positions.get(component.id)! })) };
}

export function formatSignal(value: number | undefined, width: number, format: 'binary' | 'decimal' | 'hex' = 'hex'): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  if (format === 'binary') return value.toString(2).padStart(width, '0');
  if (format === 'hex') return `0x${value.toString(16).toUpperCase().padStart(Math.ceil(width / 4), '0')}`;
  return String(value);
}

/** Read the selected hierarchy instance instead of constructing fresh sequential state. */
export function readScopedSignal(simulator: Simulator | null | undefined, prefix: string, nodeId: string, pin: string): number | undefined {
  try { return simulator?.read(`${prefix}${nodeId}`, pin); } catch { return undefined; }
}

export function parseMemoryContents(text: string, width: number, addressWidth: number): number[] | null {
  if (!text.trim()) return [];
  const parts = text.trim().split(/[\s,]+/);
  if (parts.length > 2 ** addressWidth) return null;
  const values = parts.map(part => /^(?:\d+|0x[\da-f]+|0b[01]+)$/i.test(part) ? Number(part) : NaN);
  return values.every(value => Number.isSafeInteger(value) && value >= 0 && value < 2 ** width) ? values : null;
}
