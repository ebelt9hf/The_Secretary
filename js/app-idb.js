'use strict';

/**
 * Secretary: IndexedDB Persistent Storage Adapter (js/app-idb.js)
 *
 * Implements the operational IndexedDB layer for local data storage,
 * providing structured object stores for notes, generic docs, assets,
 * and transaction write-ahead logging (WAL).
 *
 * Designed to execute cleanly in both Main Thread (window) and
 * Background Worker (self / WorkerGlobalScope) environments.
 */
const VaultIDBStorage = {
  DB_NAME: 'SecretaryFirebaseVaultDB',
  DB_VERSION: 4,
  _db: null,
  _openPromise: null,
  _memFallback: {
    meta: new Map(),
    notes: new Map(),
    docs: new Map(),
    assets: new Map(),
    wal: new Map()
  },

  async getDB() {
    if (this._db) return this._db;
    if (this._openPromise) return this._openPromise;

    const idb = typeof window !== 'undefined'
      ? (window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB)
      : (typeof self !== 'undefined' && self.indexedDB ? self.indexedDB : (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null));
    if (!idb) return null;

    this._openPromise = new Promise((resolve) => {
      const openTimer = setTimeout(() => {
        this._openPromise = null;
        resolve(null);
      }, 5000);
      try {
        const req = idb.open(this.DB_NAME, this.DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          const tx = req.transaction;
          if (!db.objectStoreNames.contains('meta')) {
            db.createObjectStore('meta', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('notes')) {
            const notesStore = db.createObjectStore('notes', { keyPath: 'id' });
            notesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          } else if (tx && tx.objectStore) {
            const notesStore = tx.objectStore('notes');
            if (!notesStore.indexNames.contains('updatedAt')) {
              notesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }
          }
          if (!db.objectStoreNames.contains('queue')) {
            db.createObjectStore('queue', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('docs')) {
            const docsStore = db.createObjectStore('docs', { keyPath: 'id' });
            docsStore.createIndex('kind', 'kind', { unique: false });
            docsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          } else if (tx && tx.objectStore) {
            const docsStore = tx.objectStore('docs');
            if (!docsStore.indexNames.contains('kind')) {
              docsStore.createIndex('kind', 'kind', { unique: false });
            }
            if (!docsStore.indexNames.contains('updatedAt')) {
              docsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }
          }
          if (!db.objectStoreNames.contains('assets')) {
            const assetsStore = db.createObjectStore('assets', { keyPath: 'id' });
            assetsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          } else if (tx && tx.objectStore) {
            const assetsStore = tx.objectStore('assets');
            if (!assetsStore.indexNames.contains('updatedAt')) {
              assetsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }
          }
          if (!db.objectStoreNames.contains('wal')) {
            const walStore = db.createObjectStore('wal', { keyPath: 'id' });
            walStore.createIndex('timestamp', 'timestamp', { unique: false });
          } else if (tx && tx.objectStore) {
            const walStore = tx.objectStore('wal');
            if (!walStore.indexNames.contains('timestamp')) {
              walStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
          }
        };
        req.onsuccess = (e) => {
          clearTimeout(openTimer);
          this._db = e.target.result;
          this._openPromise = null;
          resolve(this._db);
        };
        req.onerror = () => {
          clearTimeout(openTimer);
          this._openPromise = null;
          resolve(null);
        };
        req.onblocked = () => {
          clearTimeout(openTimer);
          this._openPromise = null;
          resolve(null);
        };
      } catch (err) {
        clearTimeout(openTimer);
        this._openPromise = null;
        resolve(null);
      }
    });
    return this._openPromise;
  },

  async _runTx(storeName, mode, opFn, fallbackVal = false, timeoutMs = 3000) {
    const db = await this.getDB();
    if (!db) return fallbackVal;
    return new Promise((resolve) => {
      let isSettled = false;
      const safeResolve = (val) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        resolve(val);
      };
      const timer = setTimeout(() => safeResolve(fallbackVal), timeoutMs);
      try {
        const tx = db.transaction(storeName, mode);
        tx.oncomplete = () => safeResolve(fallbackVal === false ? true : undefined);
        tx.onerror = () => safeResolve(fallbackVal);
        tx.onabort = () => safeResolve(fallbackVal);
        opFn(tx, tx.objectStore(storeName), safeResolve);
      } catch (err) {
        safeResolve(fallbackVal);
      }
    });
  },

  async saveMeta(key, value) {
    const db = await this.getDB();
    if (!db) {
      this._memFallback.meta.set(key, value);
      return true;
    }
    return this._runTx('meta', 'readwrite', (tx, store, done) => {
      store.put({ key, value });
      tx.oncomplete = () => done(true);
    }, false, 3000);
  },

  async getMeta(key) {
    const db = await this.getDB();
    if (!db) return this._memFallback.meta.get(key) || null;
    return this._runTx('meta', 'readonly', (tx, store, done) => {
      const req = store.get(key);
      req.onsuccess = () => done(req.result ? req.result.value : null);
    }, null, 3000);
  },

  async deleteMeta(key) {
    const db = await this.getDB();
    if (!db) {
      this._memFallback.meta.delete(key);
      return true;
    }
    return this._runTx('meta', 'readwrite', (tx, store, done) => {
      store.delete(key);
      tx.oncomplete = () => done(true);
    }, false, 3000);
  },

  // ── Generic record helpers for stores ──
  async putRecord(storeName, rec) {
    if (!rec || !rec.id) return false;
    const db = await this.getDB();
    if (!db) {
      if (!this._memFallback[storeName]) this._memFallback[storeName] = new Map();
      this._memFallback[storeName].set(rec.id, rec);
      return true;
    }
    return this._runTx(storeName, 'readwrite', (tx, store, done) => {
      store.put(rec);
      tx.oncomplete = () => done(true);
    }, false, 3000);
  },

  async getRecord(storeName, id) {
    if (!id) return null;
    const db = await this.getDB();
    if (!db) return this._memFallback[storeName]?.get(id) || null;
    return this._runTx(storeName, 'readonly', (tx, store, done) => {
      const req = store.get(id);
      req.onsuccess = () => done(req.result || null);
    }, null, 3000);
  },

  async getAllRecords(storeName) {
    const db = await this.getDB();
    if (!db) return Array.from(this._memFallback[storeName]?.values() || []);
    return this._runTx(storeName, 'readonly', (tx, store, done) => {
      const req = store.getAll();
      req.onsuccess = () => done(req.result || []);
    }, [], 5000);
  },

  async deleteRecord(storeName, id) {
    if (!id) return false;
    const db = await this.getDB();
    if (!db) {
      if (this._memFallback[storeName]) this._memFallback[storeName].delete(id);
      return true;
    }
    return this._runTx(storeName, 'readwrite', (tx, store, done) => {
      store.delete(id);
      tx.oncomplete = () => done(true);
    }, false, 3000);
  },

  // ── Note entity operations ──
  async putNote(docRecord, maybeData) {
    if (typeof docRecord === 'string') {
      const rec = maybeData && typeof maybeData === 'object' ? { ...maybeData, id: docRecord } : { id: docRecord };
      return this.putRecord('notes', rec);
    }
    return this.putRecord('notes', docRecord);
  },

  async saveNote(cleanId, docRecord) {
    if (typeof cleanId === 'string' && docRecord && typeof docRecord === 'object') {
      return this.putNote({ ...docRecord, id: cleanId });
    }
    return this.putNote(cleanId);
  },

  async putNotesBatch(docRecords = []) {
    if (!Array.isArray(docRecords) || docRecords.length === 0) return false;
    const db = await this.getDB();
    if (!db) {
      for (const rec of docRecords) {
        if (rec && rec.id) this._memFallback.notes.set(rec.id, rec);
      }
      return true;
    }
    return this._runTx('notes', 'readwrite', (tx, store, done) => {
      for (const rec of docRecords) {
        if (rec && rec.id) store.put(rec);
      }
      tx.oncomplete = () => done(true);
    }, false, 5000);
  },

  async getNote(cleanId) {
    return this.getRecord('notes', cleanId);
  },

  async getAllNotes() {
    return this.getAllRecords('notes');
  },

  async deleteNote(cleanId) {
    return this.deleteRecord('notes', cleanId);
  },

  async clearNotes() {
    return this.clearStore('notes');
  },

  // ── Generic docs operations (worker & DAO compatibility) ──
  async saveDoc(kindOrKey, docKeyOrRecord, maybeRecord) {
    if (maybeRecord !== undefined) {
      const docKey = `${kindOrKey}:${docKeyOrRecord}`;
      return this.putRecord('docs', { ...maybeRecord, id: docKey, kind: kindOrKey });
    }
    const docKey = kindOrKey;
    const docRecord = docKeyOrRecord;
    if (typeof docKey === 'string' && docRecord && typeof docRecord === 'object') {
      return this.putRecord('docs', { ...docRecord, id: docKey });
    }
    return this.putRecord('docs', docKey);
  },

  async getDoc(kindOrKey, maybeKey) {
    if (maybeKey !== undefined) {
      const compound = await this.getRecord('docs', `${kindOrKey}:${maybeKey}`);
      if (compound) return compound;
      return this.getRecord('docs', maybeKey);
    }
    return this.getRecord('docs', kindOrKey);
  },

  async getAllDocs() {
    return this.getAllRecords('docs');
  },

  async deleteDoc(kindOrKey, maybeKey) {
    if (maybeKey !== undefined) {
      await this.deleteRecord('docs', `${kindOrKey}:${maybeKey}`);
      return this.deleteRecord('docs', maybeKey);
    }
    return this.deleteRecord('docs', kindOrKey);
  },

  // ── Asset operations (worker & DAO compatibility) ──
  async saveAsset(assetId, assetRecord) {
    if (typeof assetId === 'string' && assetRecord && typeof assetRecord === 'object') {
      return this.putRecord('assets', { ...assetRecord, id: assetId });
    }
    return this.putRecord('assets', assetId);
  },

  async getAsset(assetId) {
    return this.getRecord('assets', assetId);
  },

  async getAllAssets() {
    return this.getAllRecords('assets');
  },

  async deleteAsset(assetId) {
    return this.deleteRecord('assets', assetId);
  },

  async getRecordsByIndex(storeName, indexName, keyRangeOrValue) {
    const db = await this.getDB();
    if (!db) {
      if (!this._memFallback[storeName]) return [];
      const list = Array.from(this._memFallback[storeName].values());
      return list.filter(item => item && item[indexName] === keyRangeOrValue);
    }
    return this._runTx(storeName, 'readonly', (tx, store, done) => {
      if (!store.indexNames.contains(indexName)) {
        const req = store.getAll();
        req.onsuccess = () => {
          done(req.result ? req.result.filter(item => item && item[indexName] === keyRangeOrValue) : []);
        };
        return;
      }
      const req = store.index(indexName).getAll(keyRangeOrValue);
      req.onsuccess = () => done(req.result || []);
    }, [], 5000);
  },

  async clearStore(storeName) {
    const db = await this.getDB();
    if (!db) {
      if (this._memFallback[storeName]) this._memFallback[storeName].clear();
      return true;
    }
    return this._runTx(storeName, 'readwrite', (tx, store, done) => {
      store.clear();
      tx.oncomplete = () => done(true);
    }, false, 3000);
  },

  // ── Write-Ahead Transaction Logging (WAL) ──
  async appendWAL(entry) {
    if (!entry || !entry.id) return false;
    const rec = {
      id: entry.id,
      type: entry.type || 'note',
      targetId: entry.targetId || entry.id,
      payload: entry.payload || null,
      timestamp: entry.timestamp || Date.now()
    };
    const db = await this.getDB();
    if (!db) {
      this._memFallback.wal.set(entry.id, rec);
      return true;
    }
    return this._runTx('wal', 'readwrite', (tx, store, done) => {
      store.put(rec);
      tx.oncomplete = () => done(true);
    }, false, 3000);
  },

  async getPendingWAL() {
    const db = await this.getDB();
    if (!db) {
      const list = Array.from(this._memFallback.wal.values());
      list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      return list;
    }
    return this._runTx('wal', 'readonly', (tx, store, done) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        done(list);
      };
    }, [], 5000);
  },

  async clearWAL(ids = null) {
    const db = await this.getDB();
    if (!db) {
      if (ids === null || ids === undefined) {
        this._memFallback.wal.clear();
      } else if (Array.isArray(ids)) {
        for (const id of ids) if (id) this._memFallback.wal.delete(id);
      } else {
        this._memFallback.wal.delete(ids);
      }
      return true;
    }
    return this._runTx('wal', 'readwrite', (tx, store, done) => {
      if (ids === null || ids === undefined) {
        store.clear();
      } else if (Array.isArray(ids)) {
        for (const id of ids) {
          if (id) store.delete(id);
        }
      } else {
        store.delete(ids);
      }
      tx.oncomplete = () => done(true);
    }, false, 3000);
  },

  _lockQueues: new Map(),

  async withLock(resourceId, asyncFn) {
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
      try {
        return await navigator.locks.request(`secretary_lock_${resourceId}`, asyncFn);
      } catch (e) {
        // Fall back to in-process mutex
      }
    }

    if (!this._lockQueues) this._lockQueues = new Map();
    const prevPromise = this._lockQueues.get(resourceId) || Promise.resolve();

    let releaseLock;
    const currentLockPromise = new Promise(resolve => {
      releaseLock = resolve;
    });
    this._lockQueues.set(resourceId, prevPromise.then(() => currentLockPromise, () => currentLockPromise));

    try {
      await prevPromise;
      return await asyncFn();
    } finally {
      releaseLock();
    }
  }
};

// Global / Environment exports
if (typeof window !== 'undefined') {
  window.VaultIDBStorage = VaultIDBStorage;
}
if (typeof self !== 'undefined') {
  self.VaultIDBStorage = VaultIDBStorage;
}
if (typeof globalThis !== 'undefined') {
  globalThis.VaultIDBStorage = VaultIDBStorage;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VaultIDBStorage };
}
