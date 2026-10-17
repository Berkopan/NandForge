import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../src/persistence/projects';
import { listProjects, saveProject, deleteProject, readPreference, writePreference, getUnreadableProjectCount } from '../../src/persistence/storage';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

describe('local storage fallback and preferences', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', new MemoryStorage());
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('creates, updates, lists by recency and deletes independent projects', async () => {
    const first = createProject('First');
    first.lastOpenedAt = '2026-10-01T10:00:00.000Z';
    const second = createProject('Second');
    second.lastOpenedAt = '2026-10-17T10:00:00.000Z';
    await saveProject(first); await saveProject(second);
    expect((await listProjects()).map(({ name }) => name)).toEqual(['Second', 'First']);
    first.name = 'Renamed first';
    await saveProject(first);
    expect(await listProjects()).toHaveLength(2);
    expect((await listProjects())[1]?.name).toBe('Renamed first');
    await deleteProject(second.id);
    expect((await listProjects()).map(({ id }) => id)).toEqual([first.id]);
  });

  it('reports corrupted storage without overwriting the saved bytes', async () => {
    localStorage.setItem('nandforge.projects.v1', '{broken');
    await expect(listProjects()).rejects.toThrow();
    await expect(saveProject(createProject('New'))).rejects.toThrow();
    expect(localStorage.getItem('nandforge.projects.v1')).toBe('{broken');
  });

  it('validates persisted documents on read and keeps unrelated data isolated', async () => {
    localStorage.setItem('unrelated', 'still here');
    localStorage.setItem('nandforge.projects.v1', '[{"kind":"not-a-project"}]');
    await expect(listProjects()).resolves.toEqual([]);
    expect(getUnreadableProjectCount()).toBe(1);
    expect(localStorage.getItem('unrelated')).toBe('still here');
  });

  it('round-trips preference values and falls back on absent or invalid data', () => {
    expect(readPreference('language', 'en')).toBe('en');
    writePreference('language', 'tr');
    expect(readPreference('language', 'en')).toBe('tr');
    localStorage.setItem('nandforge.language', 'invalid-json');
    expect(readPreference('language', 'en')).toBe('en');
  });

  it('propagates write failures so the interface can report unsaved work', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    await expect(saveProject(createProject('Cannot save'))).rejects.toThrow(/Quota/i);
  });
});
