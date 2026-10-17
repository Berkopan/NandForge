import { COMPONENT_CATALOG, getComponentSpec } from './catalog';
import type { ChipDefinition, Circuit, Component, ComponentSpec, Diagnostic, PortBinding } from './types';

const supported = new Set<string>([...COMPONENT_CATALOG.map(entry => entry.type), 'CHIP']);
const MAX_COMPONENTS = 25_000;
const MAX_CONNECTIONS = 150_000;
const MAX_HIERARCHY = 48;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 180 && !value.includes('\0') && !value.includes('/');
const bits = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= 16;

export class CircuitError extends Error {
  readonly diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics.map(item => item.message).join('\n'));
    this.name = 'CircuitError';
    this.diagnostics = diagnostics;
  }
}

/** Structural checks precede flattening so incomplete editor drafts produce actionable diagnostics. */
export function validateStructure(circuit: Circuit, chips: readonly ChipDefinition[] = []): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const add = (code: string, message: string, context: Partial<Diagnostic> = {}) => diagnostics.push({ code, message, severity: 'error', ...context });
  const chipMap = new Map<string, ChipDefinition>();
  if (!Array.isArray(chips)) return [{ code: 'INVALID_CIRCUIT', message: 'Chip definitions must be an array.', severity: 'error' }];
  for (const chip of chips) {
    if (!chip || !identifier(chip.id)) { add('INVALID_PORT', 'Every chip needs a nonempty, valid identifier.'); continue; }
    if (chipMap.has(chip.id)) add('DUPLICATE_ID', `Chip identifier “${chip.id}” is duplicated.`);
    chipMap.set(chip.id, chip);
  }
  const checked = new Set<string>();

  const checkPorts = (chip: ChipDefinition, instanceId: string): void => {
    if (!Array.isArray(chip.inputs) || !Array.isArray(chip.outputs) || !Number.isInteger(chip.version) || chip.version < 1) {
      add('INVALID_PORT', `Chip “${chip.name}” has an invalid typed interface or version.`, { nodeId: instanceId });
      return;
    }
    const nodes = new Map((Array.isArray(chip.circuit?.components) ? chip.circuit.components : []).filter(component => component && typeof component === 'object').map(component => [component.id, component]));
    const names = new Set<string>();
    const boundInputs = new Set<string>();
    const check = (port: PortBinding, direction: 'input' | 'output'): void => {
      if (!port || !identifier(port.name) || !identifier(port.nodeId) || !bits(port.width)) {
        add('INVALID_PORT', `Chip “${chip.name}” has an invalid ${direction} port.`, { nodeId: instanceId });
        return;
      }
      if (names.has(port.name)) add('INVALID_PORT', `Chip “${chip.name}” repeats port name “${port.name}”.`, { nodeId: instanceId, pin: port.name });
      names.add(port.name);
      const node = nodes.get(port.nodeId);
      if (!node || node.type !== (direction === 'input' ? 'INPUT' : 'OUTPUT')) {
        add('INVALID_PORT', `Chip port “${port.name}” must bind to an internal ${direction.toUpperCase()} component.`, { nodeId: instanceId, pin: port.name });
      } else if ((node.config?.width ?? 1) !== port.width) {
        add('WIDTH_MISMATCH', `Chip port “${port.name}” is ${port.width} bit, but its bound node has a different width.`, { nodeId: instanceId, pin: port.name });
      }
      if (direction === 'input') {
        if (boundInputs.has(port.nodeId)) add('INVALID_PORT', `Internal input “${port.nodeId}” is bound more than once.`, { nodeId: instanceId, pin: port.name });
        boundInputs.add(port.nodeId);
      }
    };
    chip.inputs.forEach(port => check(port, 'input'));
    chip.outputs.forEach(port => check(port, 'output'));
    for (const node of nodes.values()) {
      if (node.type === 'INPUT' && !boundInputs.has(node.id)) {
        add('UNBOUND_PORT', `Internal input “${node.id}” is absent from chip “${chip.name}”'s interface. Use a constant for private fixed values.`, { nodeId: instanceId });
      }
    }
  };

  const inspect = (current: Circuit, ancestry: readonly string[], prefix = ''): void => {
    if (!current || typeof current !== 'object' || !Array.isArray(current.components) || !Array.isArray(current.connections) || current.version !== 1) {
      add('INVALID_CIRCUIT', 'A circuit must contain component and connection arrays and schema version 1.');
      return;
    }
    if (current.components.length > MAX_COMPONENTS || current.connections.length > MAX_CONNECTIONS || ancestry.length > MAX_HIERARCHY) {
      add('LIMIT_EXCEEDED', 'Circuit exceeds the supported component, wire, or hierarchy limits.');
      return;
    }
    const nodes = new Map<string, Component>();
    const specs = new Map<string, ComponentSpec>();
    for (const node of current.components) {
      if (!node || !identifier(node.id)) { add('DUPLICATE_ID', 'Component identifiers must be nonempty, unique, and may not contain a slash.'); continue; }
      const nodeId = `${prefix}${node.id}`;
      if (nodes.has(node.id)) { add('DUPLICATE_ID', `Component identifier “${node.id}” is duplicated.`, { nodeId }); continue; }
      nodes.set(node.id, node);
      if (!supported.has(node.type)) { add('INVALID_COMPONENT', `Unsupported component type “${String(node.type)}”.`, { nodeId }); continue; }
      if (!node.config || typeof node.config !== 'object' || Array.isArray(node.config)) { add('INVALID_CONFIG', `Component “${node.id}” needs a configuration object.`, { nodeId }); continue; }
      const width = node.config.width ?? 1;
      const addressWidth = node.config.addressWidth ?? 8;
      if (!bits(width)) { add('INVALID_WIDTH', 'Bus width must be an integer from 1 through 16.', { nodeId }); continue; }
      if ((node.type === 'CLOCK' || node.type === 'HALF_ADDER' || node.type === 'FULL_ADDER') && width !== 1) {
        add('INVALID_WIDTH', `${node.type} uses single-bit pins. Choose a multi-bit adder or bus instead.`, { nodeId });
      }
      if (node.type === 'DECODER' && width > 8) add('INVALID_WIDTH', 'Decoder input width must be from 1 through 8.', { nodeId });
      for (const key of ['value', 'initial'] as const) {
        const value = node.config[key];
        if (value !== undefined && (!Number.isInteger(value) || value < 0 || value >= 2 ** width)) {
          add('INVALID_CONFIG', `${key} must be an unsigned ${width}-bit integer.`, { nodeId });
        }
      }
      if (node.type === 'RAM' || node.type === 'ROM') {
        if (!bits(addressWidth)) add('INVALID_WIDTH', 'Memory address width must be an integer from 1 through 16.', { nodeId });
        if (node.config.contents !== undefined && (!Array.isArray(node.config.contents) || node.config.contents.length > 2 ** addressWidth || node.config.contents.some(value => !Number.isInteger(value) || value < 0 || value >= 2 ** width))) {
          add('INVALID_CONFIG', 'Memory contents must fit both the word width and address capacity.', { nodeId });
        }
      }
      if (node.type === 'CHIP') {
        const chip = chipMap.get(node.config.chipId ?? '');
        if (!chip) { add('MISSING_CHIP', `Chip definition “${node.config.chipId ?? '(none)'}” is missing.`, { nodeId }); continue; }
        if (ancestry.includes(chip.id)) {
          add('RECURSIVE_CHIP', `Recursive chip definitions are unsupported: ${[...ancestry, chip.id].join(' → ')}.`, { nodeId });
          continue;
        }
        if (!checked.has(chip.id)) {
          checkPorts(chip, nodeId);
          inspect(chip.circuit, [...ancestry, chip.id], `${nodeId}/`);
          checked.add(chip.id);
        }
      }
      try { specs.set(node.id, getComponentSpec(node, chips)); }
      catch { add('INVALID_COMPONENT', `Cannot determine pins for component “${node.id}”.`, { nodeId }); }
    }
    const driven = new Set<string>();
    const wireIds = new Set<string>();
    for (const wire of current.connections) {
      if (!wire || !identifier(wire.id) || !wire.from || !wire.to) { add('INVALID_PIN', 'Every connection needs an identifier and two valid pin endpoints.'); continue; }
      const context = { connectionId: wire.id, nodeId: `${prefix}${wire.to.node}`, pin: wire.to.pin };
      if (wireIds.has(wire.id)) add('DUPLICATE_ID', `Connection identifier “${wire.id}” is duplicated.`, context);
      wireIds.add(wire.id);
      const source = nodes.get(wire.from.node);
      const target = nodes.get(wire.to.node);
      if (!source || !target) { add('MISSING_NODE', 'A wire references a component that does not exist.', context); continue; }
      const sourceSpec = specs.get(source.id);
      const targetSpec = specs.get(target.id);
      if (!sourceSpec || !targetSpec) continue;
      const from = sourceSpec.outputs.find(pin => pin.name === wire.from.pin);
      const to = targetSpec.inputs.find(pin => pin.name === wire.to.pin);
      if (!from || !to) { add('INVALID_PIN', `Connect an output pin to an input pin: ${wire.from.node}.${wire.from.pin} → ${wire.to.node}.${wire.to.pin}.`, context); continue; }
      if (from.width !== to.width) add('WIDTH_MISMATCH', `Cannot connect ${from.width}-bit ${wire.from.node}.${from.name} to ${to.width}-bit ${wire.to.node}.${to.name}. Use a splitter or joiner.`, context);
      const key = `${wire.to.node}\0${wire.to.pin}`;
      if (driven.has(key)) add('MULTIPLE_DRIVERS', `Input ${wire.to.node}.${wire.to.pin} has more than one driver.`, context);
      driven.add(key);
    }
    for (const [id, spec] of specs) {
      for (const pin of spec.inputs) {
        if (!pin.optional && !driven.has(`${id}\0${pin.name}`)) {
          add('MISSING_INPUT', `Connect required input ${id}.${pin.name} (${pin.width} bit).`, { nodeId: `${prefix}${id}`, pin: pin.name });
        }
      }
    }
  };
  inspect(circuit, []);
  return diagnostics;
}
