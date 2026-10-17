import type { ChipDefinition, Circuit, Component, ComponentType, Connection } from '../core/types';
import { getComponentSpec, validateCircuit } from '../core';

export const PROJECT_SCHEMA_VERSION = 1;
export const MAX_PROJECT_BYTES = 4 * 1024 * 1024;
export const MAX_SHARE_LENGTH = 12000;
const MAX_COMPONENTS = 10000;
const MAX_CONNECTIONS = 40000;
const MAX_CHIPS = 128;

export interface Project {
  kind: 'nandforge-project';
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  circuit: Circuit;
  chips: ChipDefinition[];
  source: string;
}

export interface ParseProjectOptions {
  /** Internal storage can reopen typed editing drafts whose circuit logic is not yet valid. */
  allowDraft?: boolean;
}

export class ProjectError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'ProjectError'; }
}

export function uniqueId(prefix = 'project'): string {
  // getRandomValues is also available on ordinary HTTP development origins.
  // randomUUID is restricted to secure contexts and would prevent a new workspace from opening.
  const random = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}-${Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function createProject(name = 'Untitled circuit', circuit?: Circuit): Project {
  const now = new Date().toISOString();
  return {
    kind: 'nandforge-project', schemaVersion: 1, id: uniqueId(), name,
    createdAt: now, updatedAt: now, lastOpenedAt: now,
    circuit: circuit ?? { id: uniqueId('circuit'), name, version: 1, components: [], connections: [] },
    chips: [], source: 'LDI 3\nSTA 240\nLDI 4\nADD 240\nOUT\nHLT\n',
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProjectError('FORMAT', `${label} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || value.length > max) throw new ProjectError('FORMAT', `${label} must be text of at most ${max} characters.`);
  return value;
}
function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < min || value > max) throw new ProjectError('RANGE', `${label} must be an integer between ${min} and ${max}.`);
  return value;
}
function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new ProjectError('SIZE', `${label} must be an array with at most ${max} entries.`);
  return value;
}
function rejectUnsafeKeys(value: unknown, depth = 0): void {
  if (depth > 40) throw new ProjectError('DEPTH', 'The document is nested too deeply.');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new ProjectError('UNSAFE', `Unsupported document key: ${key}.`);
    rejectUnsafeKeys(child, depth + 1);
  }
}

const TYPES = new Set<ComponentType>(['INPUT','OUTPUT','CONST','CLOCK','NAND','NOT','AND','OR','NOR','XOR','XNOR','BUFFER','MUX','DEMUX','DECODER','HALF_ADDER','FULL_ADDER','ADDER','SUBTRACTOR','COMPARATOR','DFF','REGISTER','COUNTER','RAM','ROM','SPLIT','JOIN','CHIP']);
function parseCircuit(value: unknown): Circuit {
  const data = record(value, 'Circuit');
  if (data.version !== 1) throw new ProjectError('VERSION', 'Unsupported circuit version.');
  const components: Component[] = array(data.components, 'Components', MAX_COMPONENTS).map((entry) => {
    const node = record(entry, 'Component');
    const type = text(node.type, 'Component type') as ComponentType;
    if (!TYPES.has(type)) throw new ProjectError('TYPE', `Unknown component type: ${type}.`);
    const position = record(node.position, 'Position');
    for (const value of [position.x, position.y]) if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e7) throw new ProjectError('POSITION', 'Invalid component position.');
    const raw = record(node.config ?? {}, 'Configuration');
    const config: Component['config'] = {};
    if (raw.width !== undefined) config.width = integer(raw.width, 'Width', 1, 16);
    if (raw.addressWidth !== undefined) config.addressWidth = integer(raw.addressWidth, 'Address width', 1, 16);
    if (raw.value !== undefined) config.value = integer(raw.value, 'Value', 0, 65535);
    if (raw.initial !== undefined) config.initial = integer(raw.initial, 'Initial value', 0, 65535);
    if (raw.contents !== undefined) config.contents = array(raw.contents, 'Memory image', 65536).map((n) => integer(n, 'Memory word', 0, 65535));
    if (raw.chipId !== undefined) config.chipId = text(raw.chipId, 'Chip ID');
    if (raw.display !== undefined) {
      const display = text(raw.display, 'Display');
      if (!['switch','button','led','binary','hex','seven'].includes(display)) throw new ProjectError('DISPLAY', 'Unknown display mode.');
      config.display = display as Component['config']['display'];
    }
    return { id: text(node.id, 'Component ID'), type, label: node.label === undefined ? undefined : text(node.label, 'Label'), position: { x: position.x as number, y: position.y as number }, config };
  });
  const ids = new Set(components.map((n) => n.id));
  if (ids.size !== components.length || ids.has('')) throw new ProjectError('DUPLICATE', 'Component IDs must be unique and nonempty.');
  const connections: Connection[] = array(data.connections, 'Connections', MAX_CONNECTIONS).map((entry) => {
    const connection = record(entry, 'Connection');
    const endpoint = (value: unknown) => {
      const p = record(value, 'Endpoint');
      const node = text(p.node, 'Endpoint node');
      if (!ids.has(node)) throw new ProjectError('REFERENCE', `Wire refers to a missing component: ${node}.`);
      return { node, pin: text(p.pin, 'Pin') };
    };
    return { id: text(connection.id, 'Wire ID'), from: endpoint(connection.from), to: endpoint(connection.to) };
  });
  if (new Set(connections.map((n) => n.id)).size !== connections.length) throw new ProjectError('DUPLICATE', 'Wire IDs must be unique.');
  return { id: text(data.id, 'Circuit ID'), name: text(data.name, 'Circuit name'), description: data.description === undefined ? undefined : text(data.description, 'Description', 10000), version: 1, components, connections };
}

export function parseProject(serialized: string, options: ParseProjectOptions = {}): Project {
  if (new TextEncoder().encode(serialized).length > MAX_PROJECT_BYTES) throw new ProjectError('SIZE', 'Project exceeds the 4 MiB import limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new ProjectError('JSON', 'This file does not contain valid JSON.'); }
  rejectUnsafeKeys(parsed);
  const data = record(parsed, 'Project');
  if (data.kind !== 'nandforge-project') throw new ProjectError('FORMAT', 'This is not a NandForge project.');
  if (data.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new ProjectError('VERSION', 'Unsupported project version. Export with a compatible NandForge version.');
  const circuit = parseCircuit(data.circuit);
  const chips: ChipDefinition[] = array(data.chips, 'Chips', MAX_CHIPS).map((entry) => {
    const chip = record(entry, 'Chip');
    const ports = (value: unknown) => array(value, 'Ports', 128).map((port) => {
      const p = record(port, 'Port');
      return { name: text(p.name, 'Port name'), width: integer(p.width, 'Port width', 1, 16), nodeId: text(p.nodeId, 'Port node') };
    });
    return { id: text(chip.id, 'Chip ID'), name: text(chip.name, 'Chip name'), description: text(chip.description, 'Chip description', 10000), version: integer(chip.version, 'Chip version', 1, 1000000), inputs: ports(chip.inputs), outputs: ports(chip.outputs), circuit: parseCircuit(chip.circuit) };
  });
  if (new Set(chips.map((c) => c.id)).size !== chips.length) throw new ProjectError('DUPLICATE', 'Chip IDs must be unique.');
  for (const chip of chips) {
    const ports = [...chip.inputs, ...chip.outputs];
    if (new Set(ports.map((port) => port.name)).size !== ports.length) throw new ProjectError('PORT', `Chip ${chip.name} has duplicate port names.`);
    for (const [direction, bindings] of [['INPUT', chip.inputs], ['OUTPUT', chip.outputs]] as const) {
      const bound = new Set<string>();
      for (const port of bindings) {
        const node = chip.circuit.components.find((component) => component.id === port.nodeId);
        if (!node || node.type !== direction || (node.config.width ?? 1) !== port.width || bound.has(port.nodeId)) throw new ProjectError('PORT', `Invalid ${direction.toLowerCase()} port binding ${chip.name}.${port.name}.`);
        bound.add(port.nodeId);
      }
      if (direction === 'INPUT' && chip.circuit.components.some((node) => node.type === 'INPUT' && !bound.has(node.id))) throw new ProjectError('PORT', `Chip ${chip.name} has an unbound input port.`);
    }
  }
  const chipMap = new Map(chips.map((chip) => [chip.id, chip]));
  let expandedCount = 0;
  const walk = (current: Circuit, ancestors: string[]) => {
    if (ancestors.length > 16) throw new ProjectError('DEPTH', 'Chip nesting exceeds 16 levels.');
    expandedCount += current.components.length;
    if (expandedCount > 50000) throw new ProjectError('SIZE', 'Expanded project exceeds 50,000 components.');
    for (const component of current.components) {
      if (component.type !== 'CHIP') continue;
      const id = component.config.chipId ?? '';
      if (ancestors.includes(id)) throw new ProjectError('RECURSION', `Recursive chip definition: ${id}.`);
      const chip = chipMap.get(id);
      if (!chip) throw new ProjectError('REFERENCE', `Missing chip definition: ${id}.`);
      walk(chip.circuit, [...ancestors, id]);
    }
  };
  walk(circuit, []);
  for (const chip of chips) walk(chip.circuit, [chip.id]);
  for (const current of [circuit, ...chips.map((chip) => chip.circuit)]) {
    const nodes = new Map(current.components.map((n) => [n.id, n]));
    const driven = new Set<string>();
    for (const edge of current.connections) {
      const from = getComponentSpec(nodes.get(edge.from.node)!, chips).outputs.find((p) => p.name === edge.from.pin);
      const to = getComponentSpec(nodes.get(edge.to.node)!, chips).inputs.find((p) => p.name === edge.to.pin);
      if ((!from || !to) && !options.allowDraft) throw new ProjectError('PIN', 'A connection refers to an invalid pin.');
      if (from && to && from.width !== to.width && !options.allowDraft) throw new ProjectError('WIDTH', 'Connected pins have incompatible bus widths.');
      const target = JSON.stringify([edge.to.node, edge.to.pin]);
      if (driven.has(target) && !options.allowDraft) throw new ProjectError('DRIVERS', 'An input has multiple drivers.');
      driven.add(target);
    }
    // A width edit, rewiring in progress, or feedback experiment must survive an autosave.
    // Structure, schema, reference bounds, chip interfaces, recursion and resource limits
    // are still checked above and by every non-whitelisted engine diagnostic below.
    const editableLogicErrors = new Set(['WIDTH_MISMATCH', 'MULTIPLE_DRIVERS', 'INVALID_PIN', 'COMBINATIONAL_LOOP', 'INVALID_CONFIG', 'INVALID_WIDTH']);
    const errors = validateCircuit(current, chips).filter((d) => d.severity === 'error' && d.code !== 'MISSING_INPUT' && !(options.allowDraft && editableLogicErrors.has(d.code)));
    if (errors.length) throw new ProjectError('CIRCUIT', errors[0]!.message);
  }
  const date = (value: unknown, name: string) => {
    const result = text(value, name, 50);
    if (!Number.isFinite(Date.parse(result))) throw new ProjectError('DATE', `Invalid ${name}.`);
    return result;
  };
  return {
    kind: 'nandforge-project', schemaVersion: 1,
    id: text(data.id, 'Project ID'), name: text(data.name, 'Project name'),
    createdAt: date(data.createdAt, 'creation date'), updatedAt: date(data.updatedAt, 'update date'), lastOpenedAt: date(data.lastOpenedAt ?? data.updatedAt, 'last opened date'),
    circuit, chips, source: text(data.source ?? '', 'Assembly source', 100000),
  };
}

export function serializeProject(project: Project): string { return JSON.stringify(project, null, 2); }
export function duplicateProject(project: Project, name = `${project.name} (copy)`): Project {
  const result = structuredClone(project);
  result.id = uniqueId(); result.name = name;
  result.circuit.id = uniqueId('circuit');
  result.createdAt = result.updatedAt = result.lastOpenedAt = new Date().toISOString();
  return result;
}

export function downloadText(filename: string, content: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function encodeShare(project: Project): Promise<string> {
  const serialized = JSON.stringify(project);
  const bytes = new TextEncoder().encode(serialized);
  const compressed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const binary = Array.from(new Uint8Array(compressed), (b) => String.fromCharCode(b)).join('');
  const encoded = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  if (encoded.length > MAX_SHARE_LENGTH) throw new ProjectError('SHARE_SIZE', 'This project is too large for a share link. Export its JSON file instead.');
  return encoded;
}

export async function decodeShare(encoded: string): Promise<Project> {
  if (encoded.length > MAX_SHARE_LENGTH || !/^[\w-]+$/.test(encoded)) throw new ProjectError('SHARE_SIZE', 'Invalid or oversized share link.');
  try {
    const binary = atob(encoded.replaceAll('-', '+').replaceAll('_', '/'));
    const data = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const decoder = new TextDecoder();
    let size = 0; let result = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROJECT_BYTES) { await reader.cancel(); throw new ProjectError('SIZE', 'Shared project exceeds the import limit.'); }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    return parseProject(result);
  } catch (error) {
    if (error instanceof ProjectError) throw error;
    throw new ProjectError('SHARE_FORMAT', 'The share link could not be decoded.');
  }
}
