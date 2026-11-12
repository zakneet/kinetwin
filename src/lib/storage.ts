/**
 * Local persistence. Sessions (landmarks + measurements only, never video)
 * live in IndexedDB in this browser profile; baselines and preferences in
 * localStorage. Nothing is sent over the network.
 */
import { isBaseline, type Baseline } from './calibration';
import type { Handedness } from './landmarks';
import { parseSession, summarizeSession, type Session, type SessionSummary } from './recording';

const DB_NAME = 'kinetwin';
const DB_VERSION = 1;
const STORE = 'sessions';
const META = 'meta';

export interface SessionMeta {
  id: string;
  name: string;
  createdAt: string;
  durationMs: number;
  exerciseType: Session['exerciseType'];
  handedness: Session['handedness'];
  frameCount: number;
  hasCalibration: boolean;
  summary: SessionSummary;
}

export function toMeta(s: Session): SessionMeta {
  return {
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    durationMs: s.durationMs,
    exerciseType: s.exerciseType,
    handedness: s.handedness,
    frameCount: s.frames.length,
    hasCalibration: !!s.calibration,
    summary: summarizeSession(s),
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the local session database'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(stores, mode);
        let result: T | undefined;
        const req = fn(t);
        if (req) req.onsuccess = () => (result = req.result);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error ?? new Error('Storage transaction failed'));
        t.onabort = () => reject(t.error ?? new Error('Storage transaction aborted (storage may be full)'));
      }),
  );
}

export async function saveSession(s: Session): Promise<SessionMeta> {
  const meta = toMeta(s);
  await tx([STORE, META], 'readwrite', (t) => {
    t.objectStore(STORE).put(s);
    t.objectStore(META).put(meta);
  });
  return meta;
}

export async function listSessions(): Promise<SessionMeta[]> {
  const all = (await tx<SessionMeta[]>([META], 'readonly', (t) => t.objectStore(META).getAll())) ?? [];
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getSession(id: string): Promise<Session | null> {
  const raw = await tx<unknown>([STORE], 'readonly', (t) => t.objectStore(STORE).get(id));
  if (!raw) return null;
  const parsed = parseSession(raw);
  return parsed.ok ? { ...parsed.session, id } : null;
}

export async function renameSession(id: string, name: string): Promise<void> {
  const s = await getSession(id);
  if (!s) return;
  s.name = name.slice(0, 160);
  await saveSession(s);
}

export async function deleteSession(id: string): Promise<void> {
  await tx([STORE, META], 'readwrite', (t) => {
    t.objectStore(STORE).delete(id);
    t.objectStore(META).delete(id);
  });
}

export async function deleteAllSessions(): Promise<void> {
  await tx([STORE, META], 'readwrite', (t) => {
    t.objectStore(STORE).clear();
    t.objectStore(META).clear();
  });
}

// ---------- localStorage helpers (baselines + preferences) ----------

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode / quota) — keep working in memory */
  }
}

const baselineKey = (h: Handedness) => `kinetwin.baseline.${h}`;

export function loadBaseline(h: Handedness): Baseline | null {
  const raw = lsGet(baselineKey(h));
  if (!raw) return null;
  try {
    const b = JSON.parse(raw);
    return isBaseline(b) ? b : null;
  } catch {
    return null;
  }
}

export function storeBaseline(b: Baseline | null, h?: Handedness): void {
  if (b) lsSet(baselineKey(b.handedness), JSON.stringify(b));
  else if (h) lsSet(baselineKey(h), null);
}

export function loadPref<T>(key: string, fallback: T): T {
  const raw = lsGet(`kinetwin.pref.${key}`);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function storePref<T>(key: string, value: T): void {
  lsSet(`kinetwin.pref.${key}`, JSON.stringify(value));
}

export function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
