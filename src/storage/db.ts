import type { Project } from '../model/types';

const DB_NAME = 'atelier-3d';
const DB_VERSION = 1;
const STORE = 'projects';
/** Clé du projet en cours d'édition (un seul projet actif pour l'instant). */
const CURRENT_KEY = 'current';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function loadCurrentProject(): Promise<unknown> {
  return run('readonly', (s) => s.get(CURRENT_KEY));
}

export async function saveCurrentProject(project: Project): Promise<void> {
  // structuredClone garantit qu'on stocke un instantané, pas une référence vivante.
  await run('readwrite', (s) => s.put(structuredClone(project), CURRENT_KEY));
}

/** Sauvegarde différée : regroupe les modifications rapprochées (saisie au clavier, etc.). */
export function createAutosaver(delayMs: number, onStatus: (status: 'pending' | 'saved' | 'error', err?: unknown) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: Project | null = null;

  const flush = async () => {
    timer = undefined;
    if (!latest) return;
    const snapshot = latest;
    latest = null;
    try {
      await saveCurrentProject(snapshot);
      onStatus('saved');
    } catch (err) {
      onStatus('error', err);
    }
  };

  return {
    schedule(project: Project) {
      latest = project;
      onStatus('pending');
      clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush() {
      clearTimeout(timer);
      return flush();
    },
  };
}
