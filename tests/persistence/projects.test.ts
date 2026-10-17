import { describe, expect, it, vi } from 'vitest';
import { CircuitBuilder, compileCircuit, Simulator } from '../../src/core';
import type { ChipDefinition } from '../../src/core';
import { createProject, duplicateProject, parseProject, serializeProject, encodeShare, decodeShare, MAX_PROJECT_BYTES, MAX_SHARE_LENGTH } from '../../src/persistence/projects';
import type { Project } from '../../src/persistence/projects';

function fixture(): Project {
  const b = new CircuitBuilder('roundtrip-circuit', 'Two switches and AND');
  const a = b.input('A');
  const inputB = b.input('B');
  b.output('OUT', 1, b.gate('AND', { a, b: inputB }));
  return createProject('Round-trip project', b.layout());
}

function mutate(change: (project: Project) => void): string {
  const project = fixture();
  change(project);
  return serializeProject(project);
}

describe('project import and portability', () => {
  it('creates a portable workspace on HTTP origins without crypto.randomUUID', () => {
    const webCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: webCrypto.getRandomValues.bind(webCrypto) });
    try {
      const project = createProject('Ordinary HTTP preview');
      expect(parseProject(serializeProject(project)).id).toBe(project.id);
      expect(project.id).not.toBe(createProject().id);
    } finally { vi.unstubAllGlobals(); }
  });

  it('round-trips the complete document and preserves executable topology', () => {
    const project = fixture();
    project.source = '; source is preserved\nLDI 7\nOUT\nHLT';
    const imported = parseProject(serializeProject(project));
    expect(imported).toEqual(project);
    const simulator = new Simulator(compileCircuit(imported.circuit, imported.chips));
    for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) {
      simulator.setInput('in-A', a); simulator.setInput('in-B', b);
      expect(simulator.read('out-OUT', 'in')).toBe(a & b);
    }
  });

  it('preserves hierarchical chips and their real internal behavior', () => {
    const body = new CircuitBuilder('inverter-body', 'Inverter body');
    const input = body.input('A');
    body.output('Q', 1, body.gate('NAND', { a: input, b: input }));
    const chip: ChipDefinition = { id: 'inverter', name: 'Inverter', description: 'NAND inversion', version: 1, inputs: [{ name: 'a', width: 1, nodeId: 'in-A' }], outputs: [{ name: 'q', width: 1, nodeId: 'out-Q' }], circuit: body.circuit };
    const b = new CircuitBuilder('parent', 'Parent circuit');
    const a = b.input('A');
    b.add('CHIP', 'chip', { chipId: 'inverter' });
    b.wire(a, { node: 'chip', pin: 'a' });
    b.output('OUT', 1, { node: 'chip', pin: 'q' });
    const project = createProject('Custom chip', b.circuit);
    project.chips = [chip];
    const imported = parseProject(serializeProject(project));
    const simulator = new Simulator(compileCircuit(imported.circuit, imported.chips));
    expect(simulator.read('out-OUT', 'in')).toBe(1);
    simulator.setInput('in-A', 1);
    expect(simulator.read('out-OUT', 'in')).toBe(0);
  });

  it('allows unfinished wiring drafts while retaining their disconnected components', () => {
    const project = fixture();
    project.circuit.connections = [];
    const imported = parseProject(serializeProject(project));
    expect(imported.circuit.components).toEqual(project.circuit.components);
    expect(imported.circuit.connections).toEqual([]);
  });

  it('duplicates deeply with new project/circuit identities and independent contents', () => {
    const original = fixture();
    const duplicate = duplicateProject(original, 'Independent copy');
    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.circuit.id).not.toBe(original.circuit.id);
    expect(duplicate.name).toBe('Independent copy');
    duplicate.circuit.components[0]!.config.value = 1;
    expect(original.circuit.components[0]!.config.value).toBe(0);
  });

  it.each([
    ['invalid JSON', '{not-json'], ['wrong kind', '{"kind":"other","schemaVersion":1}'],
    ['unsafe prototype', '{"__proto__":{"polluted":true}}'],
    ['unsafe nested key', '{"ordinary":{"constructor":{"prototype":{"polluted":true}}}}'],
  ])('rejects %s without evaluating anything', (_name, source) => {
    expect(() => parseProject(source)).toThrow();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it.each([
    ['duplicate component', (p: Project) => { p.circuit.components.push(structuredClone(p.circuit.components[0]!)); }],
    ['duplicate wire', (p: Project) => { p.circuit.connections.push(structuredClone(p.circuit.connections[0]!)); }],
    ['missing endpoint', (p: Project) => { p.circuit.connections[0]!.from.node = 'absent'; }],
    ['invalid pin', (p: Project) => { p.circuit.connections[0]!.from.pin = 'unknown'; }],
    ['multiple drivers', (p: Project) => { p.circuit.connections.push({ ...structuredClone(p.circuit.connections[0]!), id: 'another-wire' }); }],
    ['mismatched bus widths', (p: Project) => { p.circuit.components[0]!.config.width = 8; }],
    ['negative signal', (p: Project) => { p.circuit.components[0]!.config.value = -1; }],
    ['out-of-width signal', (p: Project) => { p.circuit.components[0]!.config.value = 2; }],
    ['oversized label', (p: Project) => { p.circuit.components[0]!.label = 'a'.repeat(201); }],
    ['invalid date', (p: Project) => { p.createdAt = 'never'; }],
    ['invalid position', (p: Project) => { p.circuit.components[0]!.position.x = 1e8; }],
    ['slash in identifier', (p: Project) => { p.circuit.components[0]!.id = 'bad/id'; }],
    ['missing chip definition', (p: Project) => { p.circuit.components.push({ id: 'custom', type: 'CHIP', position: { x: 0, y: 0 }, config: { chipId: 'missing' } }); }],
  ])('rejects structurally invalid imports: %s', (_name, change) => {
    expect(() => parseProject(mutate(change))).toThrow();
  });

  it('rejects combinational cycles rather than importing a runnable graph', () => {
    const b = new CircuitBuilder('loop', 'Unsupported loop');
    b.add('NOT', 'invert');
    b.wire({ node: 'invert', pin: 'out' }, { node: 'invert', pin: 'in' });
    const project = createProject('Loop', b.circuit);
    expect(() => parseProject(serializeProject(project))).toThrow(/feedback|loop/i);
  });

  it('rejects recursive modules even when the recursive definition is not instantiated', () => {
    const project = createProject('Recursive');
    const b = new CircuitBuilder('recursive-body', 'Recursive');
    b.add('CHIP', 'self', { chipId: 'recursive' });
    project.chips.push({ id: 'recursive', name: 'Recursive', description: '', version: 1, inputs: [], outputs: [], circuit: b.circuit });
    expect(() => parseProject(serializeProject(project))).toThrow(/recursive/i);
  });

  it('rejects malformed unused chip port bindings before they enter the library', () => {
    const project = createProject('Bad unused chip');
    const b = new CircuitBuilder('bad-body', 'Bad body');
    project.chips.push({ id: 'bad', name: 'Bad', description: '', version: 1, inputs: [{ name: 'a', width: 1, nodeId: 'absent' }], outputs: [], circuit: b.circuit });
    expect(() => parseProject(serializeProject(project))).toThrow();
  });

  it('enforces memory word and capacity bounds, not only generic integer bounds', () => {
    const p = createProject('Invalid RAM');
    p.circuit.components.push({ id: 'ram', type: 'RAM', position: { x: 0, y: 0 }, config: { width: 8, addressWidth: 2, contents: [0, 0, 0, 0, 0] } });
    expect(() => parseProject(serializeProject(p))).toThrow();
    p.circuit.components[0]!.config.contents = [256];
    expect(() => parseProject(serializeProject(p))).toThrow();
  });

  it('rejects oversized and deeply nested documents with a bounded error', () => {
    expect(() => parseProject(' '.repeat(MAX_PROJECT_BYTES + 1))).toThrow(/limit|4 MiB/i);
    const nested = `${'{"x":'.repeat(50)}0${'}'.repeat(50)}`;
    expect(() => parseProject(nested)).toThrow(/deep/i);
  });

  it('round-trips a compressed share payload through the same schema validator', async () => {
    const project = fixture();
    project.name = 'Türkçe devre • NAND';
    const encoded = await encodeShare(project);
    expect(encoded.length).toBeLessThanOrEqual(MAX_SHARE_LENGTH);
    expect(encoded).toMatch(/^[\w-]+$/);
    expect(await decodeShare(encoded)).toEqual(project);
  });

  it('rejects corrupted or excessive compressed share payloads', async () => {
    await expect(decodeShare('!not-base64')).rejects.toThrow();
    await expect(decodeShare('a'.repeat(MAX_SHARE_LENGTH + 1))).rejects.toThrow();
    await expect(decodeShare('YWJj')).rejects.toThrow(/decoded/i);
  });

  it('bounds decompressed share size before JSON parsing', async () => {
    const compressed = await new Response(new Blob([' '.repeat(MAX_PROJECT_BYTES + 1)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    const encoded = btoa(Array.from(new Uint8Array(compressed), (byte) => String.fromCharCode(byte)).join('')).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    expect(encoded.length).toBeLessThan(MAX_SHARE_LENGTH);
    await expect(decodeShare(encoded)).rejects.toThrow(/limit/i);
  });
});
