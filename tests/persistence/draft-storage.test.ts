import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComponent, createTemplate, validateCircuit } from '../../src/core';
import { createProject, parseProject, serializeProject, type Project } from '../../src/persistence/projects';
import { deleteProject, getUnreadableProjectCount, listProjects, saveProject } from '../../src/persistence/storage';

const KEY = 'nandforge.projects.v1';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function widthDraft(): Project {
  const project = createProject('Width edit in progress', createTemplate('and'));
  project.circuit.components.find(component => component.id === 'in-a')!.config.width = 8;
  return project;
}

describe('safe typed editing drafts and fault-isolated project storage', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', new MemoryStorage());
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reopens a saved width-mismatch draft alongside other projects, with its diagnosis intact', async () => {
    const healthy = createProject('Other independent work', createTemplate('half-adder'));
    const draft = widthDraft();
    await saveProject(healthy); await saveProject(draft);
    const listed = await listProjects();
    expect(listed.map(project => project.id).sort()).toEqual([healthy.id, draft.id].sort());
    const reopened = listed.find(project => project.id === draft.id)!;
    expect(reopened.circuit).toEqual(draft.circuit);
    expect(validateCircuit(reopened.circuit).some(item => item.code === 'WIDTH_MISMATCH')).toBe(true);
    expect(getUnreadableProjectCount()).toBe(0);
    expect(() => parseProject(serializeProject(draft))).toThrow(/width/i);
  });

  it('preserves invalid-pin, driver-conflict, feedback and out-of-width-value drafts internally', () => {
    const pin = createProject('Pin change', createTemplate('and'));
    pin.circuit.connections[0]!.to.pin = 'missing-pin';
    const driven = createProject('Rewiring', createTemplate('and'));
    driven.circuit.connections.push({ ...structuredClone(driven.circuit.connections[0]!), id: 'extra-driver' });
    const loop = createProject('Feedback experiment', createTemplate('not'));
    loop.circuit.connections.find(wire => wire.to.node === 'gate')!.from = { node: 'gate', pin: 'out' };
    const value = createProject('Width shrunk after value edit', createTemplate('and'));
    value.circuit.components.find(component => component.id === 'in-a')!.config.value = 255;
    for (const project of [pin, driven, loop, value]) {
      const serialized = serializeProject(project);
      expect(() => parseProject(serialized)).toThrow();
      expect(parseProject(serialized, { allowDraft: true }).circuit).toEqual(project.circuit);
    }
  });

  it('retains schema, prototype, identifier, missing-reference and resource validation in draft mode', () => {
    const malformed: string[] = ['{"__proto__":{"polluted":true}}', '{"kind":"unknown"}'];
    for (const mutate of [
      (project: Project) => { project.circuit.components[0]!.config.width = 17; },
      (project: Project) => { project.circuit.connections[0]!.from.node = 'missing-node'; },
      (project: Project) => { project.circuit.components[0]!.id = 'invalid/id'; project.circuit.connections = []; },
      (project: Project) => { project.circuit.components.push(createComponent('CHIP', 'missing-chip', undefined, { chipId: 'absent' })); },
    ]) {
      const project = createProject('Unsafe structure', createTemplate('and'));
      mutate(project); malformed.push(serializeProject(project));
    }
    for (const serialized of malformed) expect(() => parseProject(serialized, { allowDraft: true })).toThrow();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('isolates individual malformed records and preserves their raw values during save and delete', async () => {
    const healthy = createProject('Healthy', createTemplate('and'));
    const draft = widthDraft();
    const unreadable = { kind: 'legacy-unknown', id: 'unreadable', valuable: ['preserve', { bytes: 'original data' }] };
    const rawRecords = [healthy, unreadable, null, draft];
    localStorage.setItem(KEY, JSON.stringify(rawRecords));
    expect((await listProjects()).map(project => project.id).sort()).toEqual([healthy.id, draft.id].sort());
    expect(getUnreadableProjectCount()).toBe(2);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(rawRecords);
    healthy.name = 'Renamed healthy project';
    await saveProject(healthy);
    let stored = JSON.parse(localStorage.getItem(KEY)!) as unknown[];
    expect(stored).toContainEqual(unreadable); expect(stored).toContain(null);
    await deleteProject(draft.id);
    stored = JSON.parse(localStorage.getItem(KEY)!) as unknown[];
    expect(stored).toContainEqual(unreadable); expect(stored).toContain(null);
    expect((await listProjects()).map(project => project.name)).toEqual(['Renamed healthy project']);
    expect(getUnreadableProjectCount()).toBe(2);
  });

  it('does not discard an unreadable record even when a new save has the same ID', async () => {
    const project = createProject('New work');
    const unreadable = { id: project.id, kind: 'old-format', source: 'potentially recoverable' };
    localStorage.setItem(KEY, JSON.stringify([unreadable]));
    await saveProject(project);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toContainEqual(unreadable);
    expect((await listProjects()).map(item => item.id)).toEqual([project.id]);
    await deleteProject(project.id);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([unreadable]);
  });

  it('refuses to overwrite an unreadable storage envelope and propagates failed writes', async () => {
    localStorage.setItem(KEY, '{unrecoverable-envelope');
    await expect(saveProject(widthDraft())).rejects.toThrow();
    await expect(deleteProject('anything')).rejects.toThrow();
    expect(localStorage.getItem(KEY)).toBe('{unrecoverable-envelope');
    localStorage.setItem(KEY, '[]');
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    await expect(saveProject(widthDraft())).rejects.toThrow(/Quota/i);
    expect(localStorage.getItem(KEY)).toBe('[]');
  });
});
