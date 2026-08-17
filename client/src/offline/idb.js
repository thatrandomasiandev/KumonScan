/**
 * Minimal promise wrapper over IndexedDB for the desk offline queue.
 *
 * Deliberately dependency-free: the queue needs exactly one object store with
 * put/get-all/delete/count, which is ~60 lines here versus adding `idb` to
 * the shared client package.json (a file other agents also merge into) for
 * the same four calls.
 */

const DB_NAME = 'kumonscan-desk-offline';
const DB_VERSION = 1;

export const ACTIONS_STORE = 'pending_actions';

let dbPromise = null;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openOfflineDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ACTIONS_STORE)) {
          const store = db.createObjectStore(ACTIONS_STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // A future schema bump in another tab closes us out; reopen lazily.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

async function withStore(mode, fn) {
  const db = await openOfflineDb();
  const tx = db.transaction(ACTIONS_STORE, mode);
  const result = await fn(tx.objectStore(ACTIONS_STORE));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
  return result;
}

export function idbPut(value) {
  return withStore('readwrite', (store) => requestToPromise(store.put(value)));
}

export function idbDelete(key) {
  return withStore('readwrite', (store) => requestToPromise(store.delete(key)));
}

export function idbGetAll() {
  return withStore('readonly', (store) => requestToPromise(store.getAll()));
}

export function idbCount() {
  return withStore('readonly', (store) => requestToPromise(store.count()));
}
