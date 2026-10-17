import { parseProject, type Project } from './projects';

const DB_NAME = 'nandforge-workspace';
const FALLBACK_KEY = 'nandforge.projects.v1';
let database: Promise<IDBDatabase> | undefined;
let unreadableProjectCount = 0;

function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other NandForge tabs to update local storage.'));
  });
  return database;
}
function fallbackAvailable(): boolean { return typeof indexedDB === 'undefined'; }
function fallbackRawRecords(): unknown[] {
  const data: unknown = JSON.parse(localStorage.getItem(FALLBACK_KEY) ?? '[]');
  if (!Array.isArray(data)) throw new Error('Local project storage is malformed. Export your project before resetting storage.');
  return data;
}

function parseStoredRecord(value: unknown): Project {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') throw new Error('Project record is not serializable.');
  return parseProject(serialized, { allowDraft: true });
}

function decodeRecords(records: readonly unknown[]): Project[] {
  const projects: Project[] = [];
  const seenIds = new Set<string>();
  let unreadable = 0;
  for (const record of records) {
    try {
      const project = parseStoredRecord(record);
      if (seenIds.has(project.id)) { unreadable++; continue; }
      seenIds.add(project.id);
      projects.push(project);
    } catch { unreadable++; }
  }
  unreadableProjectCount = unreadable;
  return projects;
}

/** Count from the latest successful listing. Unreadable records remain stored for recovery. */
export function getUnreadableProjectCount(): number { return unreadableProjectCount; }

function removeReadableRecord(records: readonly unknown[], id: string): unknown[] {
  return records.filter(record => {
    // Never rewrite storage from a filtered list of decoded projects: doing so would
    // silently discard the raw records that could not be opened, including a bad ID match.
    if (!record || typeof record !== 'object' || Array.isArray(record) || !Object.hasOwn(record, 'id') || Reflect.get(record, 'id') !== id) return true;
    try { return parseStoredRecord(record).id !== id; }
    catch { return true; }
  });
}

export async function listProjects(): Promise<Project[]> {
  let records: unknown[];
  if (fallbackAvailable()) records = fallbackRawRecords();
  else {
    const db = await openDatabase();
    records = await new Promise((resolve, reject) => {
      const request = db.transaction('projects', 'readonly').objectStore('projects').getAll();
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error);
    });
  }
  return decodeRecords(records).sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
}

export async function saveProject(project: Project): Promise<void> {
  const validated = parseStoredRecord(project);
  if (fallbackAvailable()) {
    const records = removeReadableRecord(fallbackRawRecords(), validated.id);
    localStorage.setItem(FALLBACK_KEY, JSON.stringify([...records, validated]));
    return;
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put(validated);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Project save was interrupted.'));
  });
}

export async function deleteProject(id: string): Promise<void> {
  if (fallbackAvailable()) {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(removeReadableRecord(fallbackRawRecords(), id)));
    return;
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite');
    transaction.objectStore('projects').delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Project deletion was interrupted.'));
  });
}

export function readPreference<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`nandforge.${key}`);
    return raw === null ? fallback : JSON.parse(raw) as T;
  } catch { return fallback; }
}
export function writePreference(key: string, value: unknown): void {
  localStorage.setItem(`nandforge.${key}`, JSON.stringify(value));
}
