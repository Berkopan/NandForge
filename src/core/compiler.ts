import { getComponentSpec } from './catalog';
import { buildBuiltinChip } from './chips';
import type { ChipDefinition, Circuit, CircuitStats, Component, ComponentSpec, Diagnostic } from './types';
import { CircuitError, validateStructure } from './validation';

export interface CompiledSource { readonly id: string; readonly signal: number; readonly width: number; readonly initial: number }
export interface CompiledState {
  readonly id: string; readonly width: number; readonly initial: number;
  readonly d: number; readonly clk: number; readonly q: number;
}
export interface CompiledMemory {
  readonly id: string; readonly kind: 'RAM' | 'ROM'; readonly width: number; readonly addressWidth: number;
  readonly addr: number; readonly d: number; readonly we: number; readonly clk: number; readonly out: number;
  readonly initial: readonly number[];
}
export interface CompiledOperation {
  readonly id: string; readonly kind: 'NAND' | 'SPLIT' | 'JOIN' | 'RAM' | 'ROM'; readonly width: number;
  readonly inputs: readonly number[]; readonly outputs: readonly number[]; readonly memory: number;
}
export interface CompiledCircuit {
  readonly id: string;
  readonly fingerprint: string;
  readonly signalCount: number;
  readonly operations: readonly CompiledOperation[];
  readonly inputs: readonly CompiledSource[];
  readonly constants: readonly CompiledSource[];
  readonly clocks: readonly CompiledSource[];
  readonly states: readonly CompiledState[];
  readonly memories: readonly CompiledMemory[];
  /** Includes top-level nodes, module ports, and slash-separated internal node paths. */
  readonly references: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly stats: CircuitStats;
  readonly expandedComponents: number;
  readonly expandedWires: number;
  readonly diagnostics: readonly Diagnostic[];
}

interface FlatNode { component: Component; spec: ComponentSpec; id: string; rootInput: boolean; pins: Map<string, number> }

class DisjointSignals {
  readonly parents: number[] = [];
  add(): number { const index = this.parents.length; this.parents.push(index); return index; }
  find(value: number): number {
    let root = value;
    while (this.parents[root] !== root) root = this.parents[root]!;
    while (this.parents[value] !== value) {
      const next = this.parents[value]!;
      this.parents[value] = root;
      value = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parents[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
  }
}

const diagnostic = (code: string, message: string, nodeId?: string): Diagnostic => ({ code, message, severity: 'error', nodeId });
const compareIds = <T extends { id: string }>(a: T, b: T) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function lower(circuit: Circuit, chips: readonly ChipDefinition[], diagnostics: readonly Diagnostic[]): CompiledCircuit {
  const chipMap = new Map(chips.map(chip => [chip.id, chip]));
  const union = new DisjointSignals();
  const flat: FlatNode[] = [];
  const references = new Map<string, Map<string, number>>();
  let expandedWires = 0;
  const pinAt = (id: string, pin: string): number => {
    const value = references.get(id)?.get(pin);
    if (value === undefined) throw new CircuitError([diagnostic('INVALID_PIN', `Cannot resolve ${id}.${pin}.`, id)]);
    return value;
  };
  const flatten = (current: Circuit, prefix: string, isRoot: boolean, depth: number): void => {
    if (depth > 64 || flat.length > 100_000 || union.parents.length > 1_000_000) {
      throw new CircuitError([diagnostic('LIMIT_EXCEEDED', 'Expanded circuit exceeds 100,000 primitive components or the hierarchy limit.')]);
    }
    const sorted = [...current.components].sort(compareIds);
    for (const component of sorted) {
      const id = `${prefix}${component.id}`;
      const spec = getComponentSpec(component, chips);
      const pins = new Map([...spec.inputs, ...spec.outputs].map(pin => [pin.name, union.add()]));
      references.set(id, pins);
      const implementation = component.type === 'CHIP' ? chipMap.get(component.config.chipId ?? '') : buildBuiltinChip(component);
      if (implementation) {
        flatten(implementation.circuit, `${id}/`, false, depth + 1);
        for (const port of implementation.inputs) union.union(pinAt(id, port.name), pinAt(`${id}/${port.nodeId}`, 'out'));
        for (const port of implementation.outputs) union.union(pinAt(id, port.name), pinAt(`${id}/${port.nodeId}`, 'in'));
      } else {
        flat.push({ component, spec, id, pins, rootInput: isRoot });
        if (flat.length > 100_000) throw new CircuitError([diagnostic('LIMIT_EXCEEDED', 'Expanded circuit exceeds 100,000 primitive components.')]);
      }
    }
    const driven = new Set<string>();
    for (const wire of current.connections) {
      union.union(pinAt(`${prefix}${wire.from.node}`, wire.from.pin), pinAt(`${prefix}${wire.to.node}`, wire.to.pin));
      driven.add(`${wire.to.node}\0${wire.to.pin}`);
    }
    expandedWires += current.connections.length;
    for (const component of sorted) {
      const spec = getComponentSpec(component, chips);
      for (const pin of spec.inputs) {
        if (!pin.optional || driven.has(`${component.id}\0${pin.name}`)) continue;
        const id = `${prefix}${component.id}/@default:${pin.name}`;
        const signal = union.add();
        union.union(signal, pinAt(`${prefix}${component.id}`, pin.name));
        const constant: Component = { id, type: 'CONST', config: { width: pin.width, value: pin.defaultValue ?? 0 }, position: { x: 0, y: 0 } };
        flat.push({ id, component: constant, spec: getComponentSpec(constant), pins: new Map([['out', signal]]), rootInput: false });
      }
    }
  };
  flatten(circuit, '', true, 0);
  flat.sort(compareIds);

  // Each electrical net has one compact integer index after hierarchy and wire aliases collapse.
  const compact = new Map<number, number>();
  const index = (original: number): number => {
    const root = union.find(original);
    const existing = compact.get(root);
    if (existing !== undefined) return existing;
    const next = compact.size;
    compact.set(root, next);
    return next;
  };
  for (let signal = 0; signal < union.parents.length; signal++) index(signal);
  for (const pins of references.values()) for (const [pin, signal] of pins) pins.set(pin, index(signal));
  for (const node of flat) for (const [pin, signal] of node.pins) {
    // Flat node pin maps are already shared with references, except generated optional constants.
    if (!references.has(node.id)) node.pins.set(pin, index(signal));
  }
  const inputs: CompiledSource[] = [];
  const constants: CompiledSource[] = [];
  const clocks: CompiledSource[] = [];
  const states: CompiledState[] = [];
  const memories: CompiledMemory[] = [];
  const unordered: CompiledOperation[] = [];
  const drivers = new Map<number, string>();
  const compilationErrors: Diagnostic[] = [];
  let memoryWords = 0;
  for (const node of flat) {
    const { component, id } = node;
    const width = component.config.width ?? 1;
    const p = (pin: string): number => {
      const signal = node.pins.get(pin);
      if (signal === undefined) throw new CircuitError([diagnostic('INVALID_PIN', `Missing primitive pin ${id}.${pin}.`, id)]);
      return signal;
    };
    if (component.type === 'INPUT' && !node.rootInput) continue;
    for (const output of node.spec.outputs) {
      const signal = p(output.name);
      const previous = drivers.get(signal);
      const key = `${id}.${output.name}`;
      if (previous) compilationErrors.push(diagnostic('MULTIPLE_DRIVERS', `Net has two drivers: ${previous} and ${key}.`, id));
      drivers.set(signal, key);
    }
    switch (component.type) {
      case 'INPUT': inputs.push({ id, width, signal: p('out'), initial: component.config.value ?? 0 }); break;
      case 'CONST': constants.push({ id, width, signal: p('out'), initial: component.config.value ?? 0 }); break;
      case 'CLOCK': clocks.push({ id, width: 1, signal: p('out'), initial: 0 }); break;
      case 'DFF': states.push({ id, width, d: p('d'), clk: p('clk'), q: p('q'), initial: component.config.initial ?? 0 }); break;
      case 'NAND': unordered.push({ id, kind: 'NAND', width, inputs: [p('a'), p('b')], outputs: [p('out')], memory: -1 }); break;
      case 'SPLIT': unordered.push({ id, kind: 'SPLIT', width, inputs: [p('in')], outputs: node.spec.outputs.map(pin => p(pin.name)), memory: -1 }); break;
      case 'JOIN': unordered.push({ id, kind: 'JOIN', width, inputs: node.spec.inputs.map(pin => p(pin.name)), outputs: [p('out')], memory: -1 }); break;
      case 'RAM': case 'ROM': {
        const memory = memories.length;
        memoryWords += 2 ** (component.config.addressWidth ?? 8);
        if (memoryWords > 1_048_576) throw new CircuitError([diagnostic('LIMIT_EXCEEDED', 'Total expanded RAM and ROM capacity exceeds 1,048,576 words (4 MiB of simulator storage).', id)]);
        memories.push({ id, kind: component.type, width, addressWidth: component.config.addressWidth ?? 8,
          addr: p('addr'), d: component.type === 'RAM' ? p('d') : -1, we: component.type === 'RAM' ? p('we') : -1,
          clk: component.type === 'RAM' ? p('clk') : -1, out: p('out'), initial: [...component.config.contents ?? []] });
        unordered.push({ id, kind: component.type, width, inputs: [p('addr')], outputs: [p('out')], memory });
        break;
      }
      case 'OUTPUT': break;
      default: throw new CircuitError([diagnostic('INVALID_COMPONENT', `${component.type} was not lowered into supported primitives.`, id)]);
    }
  }
  for (const node of flat) for (const pin of node.spec.inputs) {
    if (!drivers.has(node.pins.get(pin.name)!)) compilationErrors.push(diagnostic('MISSING_INPUT', `Expanded input ${node.id}.${pin.name} has no driver.`, node.id));
  }
  if (compilationErrors.length) throw new CircuitError(compilationErrors);

  // State outputs are sources. RAM/ROM read only depends on addr; write pins terminate at state.
  const producing = new Map<number, number>();
  unordered.forEach((operation, operationIndex) => operation.outputs.forEach(signal => producing.set(signal, operationIndex)));
  const indegree = new Uint32Array(unordered.length);
  const dependents: number[][] = Array.from({ length: unordered.length }, () => []);
  const dependencies: number[][] = [];
  unordered.forEach((operation, operationIndex) => {
    const dependenciesOfOperation = [...new Set(operation.inputs.map(signal => producing.get(signal)).filter((producer): producer is number => producer !== undefined))].sort((a, b) => a - b);
    dependencies.push(dependenciesOfOperation);
    indegree[operationIndex] = dependenciesOfOperation.length;
    dependenciesOfOperation.forEach(producer => dependents[producer]!.push(operationIndex));
  });
  const queue: number[] = [];
  indegree.forEach((count, operationIndex) => { if (count === 0) queue.push(operationIndex); });
  const operations: CompiledOperation[] = [];
  const depths = new Uint32Array(unordered.length);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]!;
    const operation = unordered[current]!;
    let parentDepth = 0;
    for (const parent of dependencies[current]!) parentDepth = Math.max(parentDepth, depths[parent]!);
    depths[current] = parentDepth + (operation.kind === 'JOIN' || operation.kind === 'SPLIT' ? 0 : 1);
    operations.push(operation);
    for (const dependent of dependents[current]!) {
      indegree[dependent] = indegree[dependent]! - 1;
      if (indegree[dependent] === 0) queue.push(dependent);
    }
  }
  if (operations.length !== unordered.length) {
    const unresolved = unordered.filter((_, operationIndex) => indegree[operationIndex]! > 0);
    throw new CircuitError([diagnostic('COMBINATIONAL_LOOP', `Unsupported combinational feedback reaches ${unresolved.slice(0, 5).map(node => node.id).join(', ')}${unresolved.length > 5 ? ', …' : ''}. Break feedback with a D flip-flop or register.`, unresolved[0]?.id)]);
  }
  let depth = 0;
  for (const value of depths) depth = Math.max(depth, value);
  const stats: CircuitStats = {
    components: circuit.components.length, wires: circuit.connections.length,
    gates: operations.reduce((sum, operation) => sum + (operation.kind === 'NAND' ? operation.width : 0), 0),
    sequential: states.length + memories.filter(memory => memory.kind === 'RAM').length, depth,
  };
  const signature = JSON.stringify({ operations, inputs, constants, clocks, states, memories, refs: [...references].map(([id, pins]) => [id, [...pins]]) });
  let hash = 2166136261;
  for (let offset = 0; offset < signature.length; offset++) hash = Math.imul(hash ^ signature.charCodeAt(offset), 16777619);
  return {
    id: circuit.id, fingerprint: `${(hash >>> 0).toString(16)}:${signature.length}`, signalCount: compact.size,
    operations, inputs, constants, clocks, states, memories, references, stats,
    expandedComponents: flat.length, expandedWires, diagnostics,
  };
}

export function compileCircuit(circuit: Circuit, chips: readonly ChipDefinition[] = []): CompiledCircuit {
  const diagnostics = validateStructure(circuit, chips);
  if (diagnostics.some(item => item.severity === 'error')) throw new CircuitError(diagnostics);
  return lower(circuit, chips, diagnostics);
}

export function validateCircuit(circuit: Circuit, chips: readonly ChipDefinition[] = []): Diagnostic[] {
  const diagnostics = validateStructure(circuit, chips);
  if (diagnostics.some(item => item.severity === 'error')) return diagnostics;
  try { return [...lower(circuit, chips, diagnostics).diagnostics]; }
  catch (error) {
    if (error instanceof CircuitError) return error.diagnostics;
    throw error;
  }
}

export { CircuitError } from './validation';
