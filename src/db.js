// src/db.js
// IndexedDB persistence wrapper for StockGuard ledger and audit logs

const DB_NAME = 'stockguard';
const DB_VERSION = 1;

let dbInstance = null;
let lastTimestamp = 0;

/**
 * Returns a monotonic timestamp to prevent primary key collision on rapid calls
 */
function getUniqueTimestamp() {
  let now = Date.now();
  if (now <= lastTimestamp) {
    now = lastTimestamp + 1;
  }
  lastTimestamp = now;
  return now;
}

/**
 * Opens or initializes the StockGuard IndexedDB database.
 * Supports both browser window.indexedDB and Node (via fake-indexeddb fallback).
 */
export async function openDB() {
  if (dbInstance) return dbInstance;

  let idb = globalThis.indexedDB;
  if (!idb) {
    try {
      const fake = await import('fake-indexeddb');
      idb = fake.indexedDB || fake.default?.indexedDB || fake.default;
      globalThis.indexedDB = idb;
    } catch {
      // Ignore if not in test/node environment
    }
  }

  if (!idb) {
    throw new Error('IndexedDB is not supported or unavailable in this environment');
  }

  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('ledger')) {
        db.createObjectStore('ledger', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('audit')) {
        db.createObjectStore('audit', { keyPath: 'ts', autoIncrement: true });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(event.target.error || new Error('Failed to open database'));
    };
  });
}

/**
 * Retrieves a ledger entry by batch ID.
 * @param {string} id - The batch ID
 * @returns {Promise<Object|null>}
 */
export async function getLedgerEntry(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ledger', 'readonly');
    const store = tx.objectStore('ledger');
    const req = store.get(id);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Creates or updates a ledger entry.
 * @param {Object} entry - Ledger record: { id, brand, intake, sold, scans, firstSeen }
 * @returns {Promise<string>} The batch ID saved
 */
export async function setLedgerEntry(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ledger', 'readwrite');
    const store = tx.objectStore('ledger');
    const req = store.put(entry);

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves all ledger entries.
 * @returns {Promise<Array<Object>>}
 */
export async function getAllLedger() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ledger', 'readonly');
    const store = tx.objectStore('ledger');
    const req = store.getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Appends an audit event to the audit log store.
 * Automatically injects ts: Date.now() if not provided.
 * @param {Object} event - { type, batchId, reason, ... }
 * @returns {Promise<Object>} The stored audit event
 */
export async function appendAuditLog(event) {
  const db = await openDB();
  const entry = {
    ...event,
    ts: event && event.ts ? event.ts : getUniqueTimestamp(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction('audit', 'readwrite');
    const store = tx.objectStore('audit');
    const req = store.put(entry);

    req.onsuccess = () => resolve(entry);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves all audit log entries.
 * @returns {Promise<Array<Object>>}
 */
export async function getAllAudit() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audit', 'readonly');
    const store = tx.objectStore('audit');
    const req = store.getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Clears all records from both ledger and audit stores.
 * @returns {Promise<boolean>}
 */
export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['ledger', 'audit'], 'readwrite');
    const ledgerStore = tx.objectStore('ledger');
    const auditStore = tx.objectStore('audit');

    ledgerStore.clear();
    auditStore.clear();

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Resets a single batch's ledger entry.
 * @param {string} id - The batch ID to delete from ledger
 * @returns {Promise<void>}
 */

export async function resetBatch(id) {
  const db = await openDB();
  return new Promise((res) => {
    const tx = db.transaction('ledger', 'readwrite');
    tx.objectStore('ledger').delete(id);
    tx.oncomplete = res;
  });
}