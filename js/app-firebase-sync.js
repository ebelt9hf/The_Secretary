'use strict';

/**
 * Secretary: IndexedDB Persistent Storage Adapter for Firebase Vault
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
      : (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
    if (!idb) return null;

    this._openPromise = new Promise((resolve) => {
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
          this._db = e.target.result;
          this._openPromise = null;
          resolve(this._db);
        };
        req.onerror = () => {
          this._openPromise = null;
          resolve(null);
        };
        req.onblocked = () => {
          this._openPromise = null;
          resolve(null);
        };
      } catch (err) {
        this._openPromise = null;
        resolve(null);
      }
    });
    return this._openPromise;
  },

  async saveMeta(key, value) {
    const db = await this.getDB();
    if (!db) {
      this._memFallback.meta.set(key, value);
      return true;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ key, value });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  async getMeta(key) {
    const db = await this.getDB();
    if (!db) {
      return this._memFallback.meta.get(key) || null;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('meta', 'readonly');
        const req = tx.objectStore('meta').get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  },

  async deleteMeta(key) {
    const db = await this.getDB();
    if (!db) {
      this._memFallback.meta.delete(key);
      return true;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  async putNote(docRecord) {
    const db = await this.getDB();
    if (!docRecord || !docRecord.id) return false;
    if (!db) {
      this._memFallback.notes.set(docRecord.id, docRecord);
      return true;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('notes', 'readwrite');
        tx.objectStore('notes').put(docRecord);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  async putNotesBatch(docRecords = []) {
    const db = await this.getDB();
    if (!Array.isArray(docRecords) || docRecords.length === 0) return false;
    if (!db) {
      for (const rec of docRecords) {
        if (rec && rec.id) this._memFallback.notes.set(rec.id, rec);
      }
      return true;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('notes', 'readwrite');
        const store = tx.objectStore('notes');
        for (const rec of docRecords) {
          if (rec && rec.id) store.put(rec);
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  async getNote(cleanId) {
    const db = await this.getDB();
    if (!cleanId) return null;
    if (!db) {
      return this._memFallback.notes.get(cleanId) || null;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('notes', 'readonly');
        const req = tx.objectStore('notes').get(cleanId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  },

  async getAllNotes() {
    const db = await this.getDB();
    if (!db) {
      return Array.from(this._memFallback.notes.values());
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('notes', 'readonly');
        const req = tx.objectStore('notes').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
        tx.onabort = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  },

  async deleteNote(cleanId) {
    const db = await this.getDB();
    if (!cleanId) return false;
    if (!db) {
      this._memFallback.notes.delete(cleanId);
      return true;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('notes', 'readwrite');
        tx.objectStore('notes').delete(cleanId);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  async clearNotes() {
    return this.clearStore('notes');
  },

  // ── Generic record helpers for the 'docs' and 'assets' stores ──
  async putRecord(storeName, rec) {
    const db = await this.getDB();
    if (!rec || !rec.id) return false;
    if (!db) {
      if (!this._memFallback[storeName]) this._memFallback[storeName] = new Map();
      this._memFallback[storeName].set(rec.id, rec);
      return true;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(rec);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  async getRecord(storeName, id) {
    const db = await this.getDB();
    if (!id) return null;
    if (!db) {
      return this._memFallback[storeName]?.get(id) || null;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  },

  async getAllRecords(storeName) {
    const db = await this.getDB();
    if (!db) {
      return Array.from(this._memFallback[storeName]?.values() || []);
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
        tx.onabort = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  },

  async getRecordsByIndex(storeName, indexName, keyRangeOrValue) {
    const db = await this.getDB();
    if (!db) {
      if (!this._memFallback[storeName]) return [];
      const list = Array.from(this._memFallback[storeName].values());
      return list.filter(item => item && item[indexName] === keyRangeOrValue);
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        if (!store.indexNames.contains(indexName)) {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result ? req.result.filter(item => item && item[indexName] === keyRangeOrValue) : []);
          req.onerror = () => resolve([]);
          return;
        }
        const index = store.index(indexName);
        const req = index.getAll(keyRangeOrValue);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
        tx.onabort = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  },

  async clearStore(storeName) {
    const db = await this.getDB();
    if (!db) {
      if (this._memFallback[storeName]) this._memFallback[storeName].clear();
      return true;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  // ── Write-Ahead Transaction Logging (WAL) ──
  async appendWAL(entry) {
    const db = await this.getDB();
    if (!entry || !entry.id) return false;
    const rec = {
      id: entry.id,
      type: entry.type || 'note',
      targetId: entry.targetId || entry.id,
      payload: entry.payload || null,
      timestamp: entry.timestamp || Date.now()
    };
    if (!db) {
      this._memFallback.wal.set(entry.id, rec);
      return true;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('wal', 'readwrite');
        tx.objectStore('wal').put(rec);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  async getPendingWAL() {
    const db = await this.getDB();
    if (!db) {
      const list = Array.from(this._memFallback.wal.values());
      list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      return list;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('wal', 'readonly');
        const req = tx.objectStore('wal').getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          resolve(list);
        };
        req.onerror = () => resolve([]);
        tx.onabort = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
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
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('wal', 'readwrite');
        const store = tx.objectStore('wal');
        if (ids === null || ids === undefined) {
          store.clear();
        } else if (Array.isArray(ids)) {
          for (const id of ids) {
            if (id) store.delete(id);
          }
        } else {
          store.delete(ids);
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
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
      if (this._lockQueues.get(resourceId) === currentLockPromise) {
        this._lockQueues.delete(resourceId);
      }
    }
  }
};

/**
 * Inter-Window & Cross-Tab Instant Sync Bus via BroadcastChannel
 */
const SyncBroadcastBus = {
  _channel: null,
  tabId: 'tab_' + Math.random().toString(36).slice(2, 9),

  init(syncService) {
    const BC = typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : (typeof globalThis !== 'undefined' ? globalThis.BroadcastChannel : (typeof window !== 'undefined' ? window.BroadcastChannel : null));
    if (!BC) return;
    try {
      if (this._channel) {
        try { this._channel.close(); } catch (e) {}
        this._channel = null;
      }
      this._channel = new BC('secretary_sync_bus');
      this._channel.onmessage = (event) => {
        const msg = event?.data;
        if (!msg || msg.sourceTabId === this.tabId) return;
        this.handleMessage(msg, syncService);
      };
    } catch (e) {
      console.warn('[SyncBroadcastBus] BroadcastChannel init error:', e);
    }
  },

  broadcast(type, payload = {}) {
    const BC = typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : (typeof globalThis !== 'undefined' ? globalThis.BroadcastChannel : (typeof window !== 'undefined' ? window.BroadcastChannel : null));
    if (!this._channel && BC) {
      try {
        this._channel = new BC('secretary_sync_bus');
      } catch (e) {}
    }
    if (!this._channel) return;
    try {
      this._channel.postMessage({
        type,
        ...payload,
        sourceTabId: this.tabId,
        timestamp: Date.now()
      });
    } catch (e) {
      console.warn('[SyncBroadcastBus] Broadcast error:', e);
    }
  },

  handleMessage(msg, syncService) {
    if (!msg || !syncService || !syncService.state.isUnlocked) return;
    if (msg.type === 'NOTE_UPDATED') {
      if (msg.docRecord && msg.cleanId) {
        syncService.state.localCache.set(msg.cleanId, msg.docRecord);
        if (msg.metaPayload) {
          syncService._updateManifestCache(msg.cleanId, msg.metaPayload);
        }
        syncService._notifyStatus('Local tab update received');
        if (typeof window !== 'undefined' && typeof window.renderBoard === 'function') {
          window.renderBoard();
        }
      }
    } else if (msg.type === 'DOC_UPDATED') {
      if (msg.docKey && msg.docRecord) {
        if (!syncService.state.encryptedDocs) syncService.state.encryptedDocs = new Map();
        syncService.state.encryptedDocs.set(msg.docKey, msg.docRecord);
        if (msg.data !== undefined) {
          if (!syncService.state.docsCache) syncService.state.docsCache = new Map();
          syncService.state.docsCache.set(msg.docKey, msg.data);
        }
        syncService._notifyStatus('Local tab doc update received');
      }
    } else if (msg.type === 'NOTE_DELETED') {
      if (msg.cleanId) {
        syncService.state.localCache.delete(msg.cleanId);
        if (syncService.state.manifestCache) syncService.state.manifestCache.delete(msg.cleanId);
        if (typeof window !== 'undefined' && typeof window.renderBoard === 'function') {
          window.renderBoard();
        }
      }
    }
  }
};

/**
 * Secretary: Firebase E2EE Synchronization & Local Firestore Cache Engine (js/app-firebase-sync.js)
 *
 * Implements Zero-Knowledge End-to-End Encrypted synchronization,
 * local Firestore IndexedDB persistence, queue debouncing, offline handling,
 * and migration between Filesystem and Firebase modes.
 */
const FirebaseSyncService = {
  STATUS: {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    SYNCED: 'synced',
    SYNCING: 'syncing',
    OFFLINE: 'offline',
    LOCKED: 'locked',
    DECLINED: 'declined',
    ERROR: 'error'
  },

  SCHEMA_VERSION: 2,
  DEFAULT_CLOUD_SYNC_DEBOUNCE_MS: 5000,

  _hashContent(str) {
    if (!str) return '0';
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return (hash >>> 0).toString(16);
  },

  validateSchemaCompatibility(recordOrMeta) {
    if (!recordOrMeta || typeof recordOrMeta !== 'object') return true;
    const ver = recordOrMeta.schemaVersion;
    if (ver !== undefined && ver !== null && !isNaN(Number(ver))) {
      return Number(ver) <= this.SCHEMA_VERSION;
    }
    return true; // legacy/v0 data defaults to valid
  },

  state: {
    engine: 'filesystem', // 'filesystem' or 'firebase'
    status: 'disconnected',
    config: null,
    vaultMeta: null,
    userId: 'default_user',
    userEmail: null,
    isAnonymous: false,
    isUnlocked: false,
    masterKey: null,
    pendingQueue: new Map(), // noteId -> noteData
    pendingDocsQueue: new Map(), // docKey -> { id, kind, docId, record }
    pendingAssetsQueue: new Map(), // assetId -> { id, record }
    syncTimer: null,
    lastSyncTimestamp: null,
    lastError: null,
    localCache: new Map(), // noteId -> { id, iv, ciphertext, updatedAt, deleted }
    manifestCache: new Map(), // cleanId -> { id, path, title, date, updatedAt, tags, workstream, pinned, archived, favorite }
    encryptedDocs: new Map(), // docKey -> { id, kind, docId, iv, ciphertext, updatedAt, deleted }
    docsCache: new Map(), // docKey -> decrypted data
    encryptedAssets: new Map(), // assetId -> { id, iv, ciphertext, mimeType, updatedAt, deleted }
    assetsCache: new Map(), // assetId -> decrypted dataUrl/string
    conflicts: new Map(), // cleanId -> { id, path, localNote, remoteNote, detectedAt }
    versionStatus: null
  },

  _listeners: new Set(),
  _versionListeners: new Set(),
  _remoteUnsubscribe: null,
  _remoteDocsUnsubscribe: null,
  _versionUnsubscribe: null,

  // ── Event & State Dispatching ──
  onStatusChange(listener) {
    if (typeof listener === 'function') {
      this._listeners.add(listener);
      listener(this.getStatus());
    }
    return () => this._listeners.delete(listener);
  },

  _notifyStatus(customMsg = null) {
    const statusObj = this.getStatus();
    if (customMsg) statusObj.message = customMsg;
    for (const listener of this._listeners) {
      try { listener(statusObj); } catch (e) { console.warn('Sync listener error', e); }
    }
  },

  getStatus() {
    const isOnline = typeof navigator !== 'undefined' && navigator.onLine !== undefined ? navigator.onLine : true;
    let effectiveStatus = this.state.status;

    if (this.state.engine === 'firebase' && !isOnline && effectiveStatus !== this.STATUS.LOCKED && effectiveStatus !== this.STATUS.DECLINED) {
      effectiveStatus = this.STATUS.OFFLINE;
    }

    const pendingTotal = this.state.pendingQueue.size + (this.state.pendingDocsQueue ? this.state.pendingDocsQueue.size : 0) + (this.state.pendingAssetsQueue ? this.state.pendingAssetsQueue.size : 0);

    return {
      engine: this.state.engine,
      status: effectiveStatus,
      isUnlocked: this.state.isUnlocked,
      userId: this.state.userId,
      userEmail: this.state.userEmail,
      isAnonymous: this.state.isAnonymous,
      pendingCount: pendingTotal,
      lastSyncTimestamp: this.state.lastSyncTimestamp,
      lastError: this.state.lastError,
      notesCount: this.state.localCache.size,
      conflictsCount: this.state.conflicts ? this.state.conflicts.size : 0,
      versionStatus: this.state.versionStatus
    };
  },

  hasPendingCloudWrites() {
    const pendingTotal = this.state.pendingQueue.size + (this.state.pendingDocsQueue ? this.state.pendingDocsQueue.size : 0) + (this.state.pendingAssetsQueue ? this.state.pendingAssetsQueue.size : 0);
    return pendingTotal > 0;
  },

  // ── 3-Way Structural Field Merging ──
  _mergeMeta(localMeta, remoteMeta) {
    if (!localMeta) return remoteMeta;
    if (!remoteMeta) return localMeta;

    // Set union of tags
    const localTags = Array.isArray(localMeta.tags) ? localMeta.tags : [];
    const remoteTags = Array.isArray(remoteMeta.tags) ? remoteMeta.tags : [];
    const mergedTags = Array.from(new Set([...localTags, ...remoteTags]));

    const localIsNewer = (localMeta.updatedAt || 0) >= (remoteMeta.updatedAt || 0);

    return {
      ...remoteMeta,
      ...localMeta,
      tags: mergedTags,
      pinned: localIsNewer ? (localMeta.pinned !== undefined ? localMeta.pinned : remoteMeta.pinned) : (remoteMeta.pinned !== undefined ? remoteMeta.pinned : localMeta.pinned),
      favorite: localIsNewer ? (localMeta.favorite !== undefined ? localMeta.favorite : remoteMeta.favorite) : (remoteMeta.favorite !== undefined ? remoteMeta.favorite : localMeta.favorite),
      archived: localIsNewer ? (localMeta.archived !== undefined ? localMeta.archived : remoteMeta.archived) : (remoteMeta.archived !== undefined ? remoteMeta.archived : localMeta.archived),
      workstream: (localIsNewer && localMeta.workstream) ? localMeta.workstream : (remoteMeta.workstream || localMeta.workstream || ''),
      updatedAt: Math.max(localMeta.updatedAt || 0, remoteMeta.updatedAt || 0)
    };
  },

  // ── Adaptive Lifecycle Flush ──
  _lifecycleAttached: false,
  setupLifecycleFlush() {
    if (this._lifecycleAttached) return;
    this._lifecycleAttached = true;
    let blurFlushTimer = null;
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.state.isUnlocked && this.hasPendingCloudWrites()) {
          this.flushQueue();
        }
      });
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('beforeunload', () => {
        if (this.state.isUnlocked && this.hasPendingCloudWrites()) {
          this.flushQueue();
        }
      });
      window.addEventListener('blur', () => {
        if (blurFlushTimer) clearTimeout(blurFlushTimer);
        blurFlushTimer = setTimeout(() => {
          blurFlushTimer = null;
          if (this.state.isUnlocked && this.hasPendingCloudWrites()) {
            this.flushQueue();
          }
        }, 200);
      });
    }
  },

  // ── Write-Ahead Log Recovery ──
  async _recoverFromWAL() {
    try {
      const pendingWal = await VaultIDBStorage.getPendingWAL();
      if (!Array.isArray(pendingWal) || pendingWal.length === 0) return 0;
      let recoveredCount = 0;
      for (const entry of pendingWal) {
        if (!entry || !entry.payload) continue;
        if (entry.type === 'note') {
          const { cleanId, docRecord, pendingItem, metaPayload } = entry.payload;
          if (cleanId && pendingItem) {
            if (docRecord) this.state.localCache.set(cleanId, docRecord);
            if (metaPayload) this._updateManifestCache(cleanId, metaPayload);
            this.state.pendingQueue.set(cleanId, pendingItem);
            recoveredCount++;
          }
        } else if (entry.type === 'meta') {
          const { cleanId, updatedDocRecord, pendingItem, updatedMetaPayload } = entry.payload;
          if (cleanId && pendingItem) {
            if (updatedDocRecord) this.state.localCache.set(cleanId, updatedDocRecord);
            if (updatedMetaPayload) this._updateManifestCache(cleanId, updatedMetaPayload);
            this.state.pendingQueue.set(cleanId, pendingItem);
            recoveredCount++;
          }
        } else if (entry.type === 'delete_note') {
          const { cleanId, docRecord } = entry.payload;
          if (cleanId) {
            if (docRecord) this.state.localCache.set(cleanId, docRecord);
            if (this.state.manifestCache) this.state.manifestCache.delete(cleanId);
            this.state.pendingQueue.set(cleanId, docRecord);
            recoveredCount++;
          }
        } else if (entry.type === 'doc_item' || entry.type === 'delete_doc_item') {
          const { docKey, docRecord } = entry.payload;
          if (docKey && docRecord) {
            if (!this.state.pendingDocsQueue) this.state.pendingDocsQueue = new Map();
            this.state.pendingDocsQueue.set(docKey, docRecord);
            recoveredCount++;
          }
        } else if (entry.type === 'asset' || entry.type === 'delete_asset') {
          const { normalizedId, assetRecord } = entry.payload;
          if (normalizedId && assetRecord) {
            if (!this.state.pendingAssetsQueue) this.state.pendingAssetsQueue = new Map();
            this.state.pendingAssetsQueue.set(normalizedId, assetRecord);
            recoveredCount++;
          }
        }
      }
      if (recoveredCount > 0) {
        this.state.status = this.STATUS.SYNCING;
        this._notifyStatus(`Recovered ${recoveredCount} pending writes from journal`);
        setTimeout(() => this.flushQueue(), 50);
      }
      return recoveredCount;
    } catch (err) {
      console.warn('[FirebaseSyncService] WAL recovery error:', err);
      return 0;
    }
  },

  // ── Manifest Cache Helpers ──
  _updateManifestCache(cleanId, noteData) {
    if (!cleanId || !noteData) return;
    if (!this.state.manifestCache) {
      this.state.manifestCache = new Map();
    }
    this.state.manifestCache.set(cleanId, {
      id: cleanId,
      path: noteData.path || `notes/${cleanId}.html`,
      title: noteData.title || 'Untitled',
      date: noteData.date || '',
      updatedAt: noteData.updatedAt || Date.now(),
      tags: Array.isArray(noteData.tags) ? noteData.tags : [],
      workstream: noteData.workstream || '',
      pinned: !!noteData.pinned,
      archived: !!noteData.archived,
      favorite: !!noteData.favorite
    });
  },

  getManifest() {
    if (!this.state.isUnlocked) return [];
    if (!this.state.manifestCache) {
      this.state.manifestCache = new Map();
    }
    return Array.from(this.state.manifestCache.values());
  },

  // ── Firebase Bridge & Cloud Connectivity ──
  getCustomFirebaseConfig() {
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('secretary_custom_firebase_config');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === 'object' && parsed.apiKey) return parsed;
        }
      }
      if (typeof settings !== 'undefined' && settings?.customFirebaseConfig?.apiKey) {
        return settings.customFirebaseConfig;
      }
    } catch (e) {}
    return null;
  },

  setCustomFirebaseConfig(config) {
    if (!config || typeof config !== 'object' || !config.apiKey) return false;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('secretary_custom_firebase_config', JSON.stringify(config));
      }
      if (typeof settings !== 'undefined' && settings) {
        settings.customFirebaseConfig = config;
        if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
      }
      this.state.config = config;
      this.ensureBridgeInitialized(config);
      return true;
    } catch (e) {
      console.warn('Failed to save custom Firebase config', e);
      return false;
    }
  },

  clearCustomFirebaseConfig() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('secretary_custom_firebase_config');
      }
      if (typeof settings !== 'undefined' && settings) {
        delete settings.customFirebaseConfig;
        if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
      }
      const defaultCfg = typeof window !== 'undefined' ? window.DEFAULT_FIREBASE_CONFIG : (typeof globalThis !== 'undefined' ? globalThis.DEFAULT_FIREBASE_CONFIG : null);
      this.state.config = defaultCfg;
      this.ensureBridgeInitialized(defaultCfg);
      return true;
    } catch (e) {
      return false;
    }
  },

  parseFirebaseConfigString(str) {
    if (!str || typeof str !== 'string') return null;
    const trimmed = str.trim();
    if (!trimmed) return null;

    // 1. Direct JSON.parse
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && parsed.apiKey) {
        return parsed;
      }
    } catch (e) {}

    // 2. Extract JSON-like object from JS snippet (e.g. const firebaseConfig = { ... };)
    try {
      const match = trimmed.match(/\{[\s\S]*\}/);
      if (match) {
        const jsonStr = match[0]
          .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
          .replace(/'/g, '"')
          .replace(/,\s*\}/g, '}');
        const parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed === 'object' && (parsed.apiKey || parsed.projectId)) {
          return parsed;
        }
      }
    } catch (e) {}

    // 3. Fallback regex extraction of standard fields
    const apiKey = (trimmed.match(/apiKey\s*[:=]\s*["']([^"']+)["']/i) || [])[1];
    const projectId = (trimmed.match(/projectId\s*[:=]\s*["']([^"']+)["']/i) || [])[1];
    const authDomain = (trimmed.match(/authDomain\s*[:=]\s*["']([^"']+)["']/i) || [])[1];
    const databaseURL = (trimmed.match(/databaseURL\s*[:=]\s*["']([^"']+)["']/i) || [])[1];
    const storageBucket = (trimmed.match(/storageBucket\s*[:=]\s*["']([^"']+)["']/i) || [])[1];
    const appId = (trimmed.match(/appId\s*[:=]\s*["']([^"']+)["']/i) || [])[1];

    if (apiKey || projectId) {
      const res = {};
      if (apiKey) res.apiKey = apiKey;
      if (projectId) res.projectId = projectId;
      if (authDomain) res.authDomain = authDomain;
      if (databaseURL) res.databaseURL = databaseURL;
      if (storageBucket) res.storageBucket = storageBucket;
      if (appId) res.appId = appId;
      return res;
    }

    return null;
  },

  async ensureBridgeInitialized(config = null) {
    const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);
    if (!bridge) return false;

    const defaultCfg = typeof window !== 'undefined' ? window.DEFAULT_FIREBASE_CONFIG : (typeof globalThis !== 'undefined' ? globalThis.DEFAULT_FIREBASE_CONFIG : null);
    const customCfg = this.getCustomFirebaseConfig();
    const hasConfig = config && typeof config === 'object' && Object.keys(config).length > 0;
    const cfg = hasConfig ? config : (this.state.config || customCfg || defaultCfg);

    if (cfg && cfg.apiKey && typeof bridge.init === 'function') {
      bridge.init(cfg);
    }

    try {
      if (typeof bridge.ensureAuth === 'function') {
        const user = await bridge.ensureAuth();
        if (user && user.uid) {
          this.state.userId = user.uid;
          this.state.userEmail = user.email || null;
          this.state.isAnonymous = !!user.isAnonymous;
        }
      }
    } catch (e) {
      console.warn('Authentication with Firebase failed, using fallback userId', e);
    }
    return true;
  },

  // ── Email / Password & User Auth API ──
  getAuthUser() {
    const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);
    const bridgeUser = bridge?.getUser?.();
    return {
      uid: (bridgeUser && bridgeUser.uid) || (this.state.userId !== 'default_user' ? this.state.userId : null),
      email: (bridgeUser && bridgeUser.email) || this.state.userEmail || null,
      isAnonymous: bridgeUser ? !!bridgeUser.isAnonymous : !!this.state.isAnonymous
    };
  },

  async signInWithEmail(email, password, config = null) {
    if (!email || !email.includes('@')) {
      throw new Error(typeof t === 'function' ? t('sync.emailRequired') : 'Please enter a valid email address');
    }
    if (!password || password.length < 6) {
      throw new Error(typeof t === 'function' ? t('sync.accountPasswordTooShort') : 'Account password must be at least 6 characters');
    }
    await this.ensureBridgeInitialized(config);
    const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);
    if (!bridge || typeof bridge.signInWithEmail !== 'function') {
      throw new Error('Firebase Authentication is not available');
    }
    const user = await bridge.signInWithEmail(email.trim(), password);
    if (user && user.uid) {
      this.state.userId = user.uid;
      this.state.userEmail = user.email || email.trim();
      this.state.isAnonymous = false;
      if (this.state.isUnlocked) {
        this.listenRemoteVault();
        this.listenRemoteDocs();
      }
      this._notifyStatus();
    }
    return user;
  },

  async signUpWithEmail(email, password, config = null) {
    if (!email || !email.includes('@')) {
      throw new Error(typeof t === 'function' ? t('sync.emailRequired') : 'Please enter a valid email address');
    }
    if (!password || password.length < 6) {
      throw new Error(typeof t === 'function' ? t('sync.accountPasswordTooShort') : 'Account password must be at least 6 characters');
    }
    await this.ensureBridgeInitialized(config);
    const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);
    if (!bridge || typeof bridge.signUpWithEmail !== 'function') {
      throw new Error('Firebase Authentication is not available');
    }
    const user = await bridge.signUpWithEmail(email.trim(), password);
    if (user && user.uid) {
      this.state.userId = user.uid;
      this.state.userEmail = user.email || email.trim();
      this.state.isAnonymous = false;
      if (this.state.isUnlocked) {
        this.listenRemoteVault();
        this.listenRemoteDocs();
      }
      this._notifyStatus();
    }
    return user;
  },

  async signOut() {
    const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);
    if (bridge && typeof bridge.signOut === 'function') {
      await bridge.signOut();
    }
    if (this._remoteUnsubscribe) {
      try { this._remoteUnsubscribe(); } catch (e) {}
      this._remoteUnsubscribe = null;
    }
    if (this._remoteDocsUnsubscribe) {
      try { this._remoteDocsUnsubscribe(); } catch (e) {}
      this._remoteDocsUnsubscribe = null;
    }
    this.state.userId = 'default_user';
    this.state.userEmail = null;
    this.state.isAnonymous = false;
    this._notifyStatus();
    return true;
  },

  async sendPasswordReset(email) {
    if (!email || !email.includes('@')) {
      throw new Error(typeof t === 'function' ? t('sync.emailRequired') : 'Please enter a valid email address');
    }
    await this.ensureBridgeInitialized();
    const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);
    if (!bridge || typeof bridge.sendPasswordReset !== 'function') {
      throw new Error('Firebase Authentication is not available');
    }
    await bridge.sendPasswordReset(email.trim());
    return true;
  },

  listenRemoteVault() {
    const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);
    if (!bridge || !this.state.userId || this.state.userId === 'default_user' || !this.state.isUnlocked) {
      return () => {};
    }
    if (this._remoteUnsubscribe) {
      this._remoteUnsubscribe();
      this._remoteUnsubscribe = null;
    }
    this._remoteUnsubscribe = bridge.listenVault(
      this.state.userId,
      async (remoteNotesMap) => {
        if (!remoteNotesMap || typeof remoteNotesMap !== 'object') return;
        let hasChanges = false;
        for (const [id, remoteDoc] of Object.entries(remoteNotesMap)) {
          if (!remoteDoc) continue;
          const cleanId = this._normalizeId(id);

          // 1. Schema v2: 2-Tier note (has meta)
          if (remoteDoc.meta && typeof remoteDoc.meta === 'object') {
            if (!this.validateSchemaCompatibility(remoteDoc.meta)) {
              console.warn(`[FirebaseSyncService] Skipping remote note ${cleanId}: requires newer schema v${remoteDoc.meta.schemaVersion}`);
              continue;
            }
            const localDoc = this.state.localCache.get(cleanId);
            const localMetaUpdated = localDoc && localDoc.meta ? (localDoc.meta.updatedAt || localDoc.updatedAt || 0) : (localDoc?.updatedAt || 0);
            const remoteMetaUpdated = remoteDoc.meta.updatedAt || remoteDoc.updatedAt || 0;

            const isPendingLocal = this.state.pendingQueue && this.state.pendingQueue.has(cleanId);

            if (localDoc && localMetaUpdated >= remoteMetaUpdated && !isPendingLocal) {
              continue;
            }

            if (remoteDoc.meta.deleted || remoteDoc.deleted) {
              const delRecord = { id: cleanId, deleted: true, updatedAt: remoteMetaUpdated };
              this.state.localCache.set(cleanId, delRecord);
              if (this.state.manifestCache) this.state.manifestCache.delete(cleanId);
              try { await VaultIDBStorage.putNote(delRecord); } catch (e) {}
              hasChanges = true;
            } else if (remoteDoc.meta.ciphertext && this.state.masterKey) {
              try {
                const decMeta = await CryptoEngine.decryptData(this.state.masterKey, {
                  iv: remoteDoc.meta.iv,
                  ciphertext: remoteDoc.meta.ciphertext
                });
                if (decMeta) {
                  let finalMeta = decMeta;
                  if (isPendingLocal && localDoc) {
                    try {
                      const localMetaDec = localDoc.contentHtml !== undefined ? localDoc : (localDoc.meta?.ciphertext ? await CryptoEngine.decryptData(this.state.masterKey, { iv: localDoc.meta.iv, ciphertext: localDoc.meta.ciphertext }) : null);
                      if (localMetaDec) {
                        finalMeta = this._mergeMeta(localMetaDec, decMeta);
                      }
                    } catch (e) {}
                  }

                  let remoteContentHtml = '';
                  if (remoteDoc.body && remoteDoc.body.ciphertext) {
                    try {
                      const decBody = await CryptoEngine.decryptData(this.state.masterKey, {
                        iv: remoteDoc.body.iv,
                        ciphertext: remoteDoc.body.ciphertext
                      });
                      if (decBody) {
                        remoteContentHtml = decBody.contentHtml !== undefined ? decBody.contentHtml : (decBody.html || '');
                      }
                    } catch (be) {}
                  }

                  const combined = {
                    ...finalMeta,
                    id: cleanId,
                    path: finalMeta.path || `notes/${cleanId}.html`,
                    contentHtml: remoteContentHtml || (localDoc ? (localDoc.contentHtml || localDoc.html || '') : ''),
                    html: remoteContentHtml || (localDoc ? (localDoc.contentHtml || localDoc.html || '') : ''),
                    updatedAt: finalMeta.updatedAt || remoteMetaUpdated,
                    deleted: false,
                    schemaVersion: this.SCHEMA_VERSION,
                    appVersion: this.getCurrentVersion(),
                    origin: 'remote_cloud'
                  };
                  this.state.localCache.set(cleanId, combined);
                  this._updateManifestCache(cleanId, finalMeta);
                  try { await VaultIDBStorage.putNote(combined); } catch (e) {}
                  hasChanges = true;
                }
              } catch (err) {
                console.warn(`Failed to decrypt remote note meta ${cleanId}:`, err);
              }
            }
            continue;
          }

          // 2. Schema v1: Legacy single-record note
          if (!remoteDoc.updatedAt) continue;
          if (!this.validateSchemaCompatibility(remoteDoc)) {
            console.warn(`[FirebaseSyncService] Skipping remote note ${cleanId}: requires newer schema v${remoteDoc.schemaVersion}`);
            continue;
          }
          const localDoc = this.state.localCache.get(cleanId);
          if (localDoc && (localDoc.updatedAt || 0) >= (remoteDoc.updatedAt || 0)) {
            continue;
          }
          if (remoteDoc.deleted) {
            const delRecord = { id: cleanId, deleted: true, updatedAt: remoteDoc.updatedAt };
            this.state.localCache.set(cleanId, delRecord);
            if (this.state.manifestCache) this.state.manifestCache.delete(cleanId);
            try { await VaultIDBStorage.putNote(delRecord); } catch (e) {}
            hasChanges = true;
          } else if (remoteDoc.ciphertext && this.state.masterKey) {
            try {
              const decrypted = await CryptoEngine.decryptData(this.state.masterKey, {
                iv: remoteDoc.iv,
                ciphertext: remoteDoc.ciphertext
              });
              if (decrypted) {
                const fullPlain = {
                  ...decrypted,
                  id: cleanId,
                  contentHtml: decrypted.contentHtml !== undefined ? decrypted.contentHtml : (decrypted.html || ''),
                  html: decrypted.contentHtml !== undefined ? decrypted.contentHtml : (decrypted.html || ''),
                  updatedAt: remoteDoc.updatedAt,
                  deleted: false,
                  origin: 'remote_cloud'
                };
                this.state.localCache.set(cleanId, fullPlain);
                this._updateManifestCache(cleanId, fullPlain);
                try { await VaultIDBStorage.putNote(fullPlain); } catch (e) {}
                hasChanges = true;
              }
            } catch (err) {
              console.warn(`Failed to decrypt remote note ${cleanId}:`, err);
            }
          }
        }
        if (hasChanges) {
          this._notifyStatus('Remote changes applied');
          if (typeof window !== 'undefined' && typeof window.renderBoard === 'function') {
            window.renderBoard();
          }
        }
      },
      (err) => {
        console.warn('Realtime Database listener error:', err);
      }
    );

    // Listen to generic & itemized documents
    if (typeof bridge.listenDocs === 'function') {
      if (this._remoteDocsUnsubscribe) {
        this._remoteDocsUnsubscribe();
        this._remoteDocsUnsubscribe = null;
      }
      this._remoteDocsUnsubscribe = bridge.listenDocs(
        this.state.userId,
        async (remoteDocsMap) => {
          if (!remoteDocsMap || typeof remoteDocsMap !== 'object') return;
          const processDocEntry = async (docKey, remoteDoc) => {
            if (!remoteDoc || !remoteDoc.updatedAt) return;
            const localDoc = await VaultIDBStorage.getRecord('docs', docKey);
            if (localDoc && (localDoc.updatedAt || 0) >= (remoteDoc.updatedAt || 0)) {
              return;
            }
            if (remoteDoc.deleted) {
              if (this.state.docsCache) this.state.docsCache.delete(docKey);
              const delDoc = { id: docKey, kind: remoteDoc.kind, docId: remoteDoc.docId, deleted: true, updatedAt: remoteDoc.updatedAt };
              try { await VaultIDBStorage.putRecord('docs', delDoc); } catch (e) {}
            } else if (remoteDoc.ciphertext && this.state.masterKey) {
              try {
                const decrypted = await CryptoEngine.decryptData(this.state.masterKey, {
                  iv: remoteDoc.iv,
                  ciphertext: remoteDoc.ciphertext
                });
                if (decrypted) {
                  const val = decrypted.data !== undefined ? decrypted.data : decrypted;
                  if (!this.state.docsCache) this.state.docsCache = new Map();
                  this.state.docsCache.set(docKey, val);
                  const plainDoc = {
                    id: docKey,
                    kind: remoteDoc.kind || (docKey.includes('__') ? docKey.split('__')[0] : 'generic'),
                    docId: remoteDoc.docId || (docKey.includes('__') ? docKey.split('__').slice(1).join('__') : docKey),
                    data: val,
                    updatedAt: remoteDoc.updatedAt,
                    deleted: false,
                    schemaVersion: this.SCHEMA_VERSION,
                    appVersion: this.getCurrentVersion(),
                    origin: 'remote_cloud'
                  };
                  try { await VaultIDBStorage.putRecord('docs', plainDoc); } catch (e) {}
                }
              } catch (e) {}
            }
          };

          for (const [keyOrKind, valOrDoc] of Object.entries(remoteDocsMap)) {
            if (!valOrDoc || typeof valOrDoc !== 'object') continue;
            if (valOrDoc.updatedAt !== undefined || valOrDoc.ciphertext !== undefined) {
              await processDocEntry(keyOrKind, valOrDoc);
            } else {
              // Nested child items (e.g. planner -> { evt1: doc, evt2: doc })
              for (const [itemId, childDoc] of Object.entries(valOrDoc)) {
                if (childDoc && typeof childDoc === 'object' && (childDoc.updatedAt || childDoc.ciphertext)) {
                  await processDocEntry(`${keyOrKind}__${itemId}`, childDoc);
                }
              }
            }
          }
        },
        (err) => {
          console.warn('Realtime Database docs listener error:', err);
        }
      );
    }

    return () => {
      if (this._remoteUnsubscribe) {
        this._remoteUnsubscribe();
        this._remoteUnsubscribe = null;
      }
      if (this._remoteDocsUnsubscribe) {
        this._remoteDocsUnsubscribe();
        this._remoteDocsUnsubscribe = null;
      }
    };
  },

  // ── Version Compatibility & Autodetection ──
  getCurrentVersion() {
    if (typeof document !== 'undefined') {
      const hintEl = document.getElementById('connect-version-hint');
      if (hintEl && hintEl.getAttribute('data-version')) {
        return hintEl.getAttribute('data-version').trim();
      }
    }
    return '4.0.0';
  },

  compareSemver(v1, v2) {
    if (!v1 && !v2) return 0;
    if (!v1) return -1;
    if (!v2) return 1;
    const clean = (v) => String(v).trim().replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
    const [maj1 = 0, min1 = 0, pat1 = 0] = clean(v1);
    const [maj2 = 0, min2 = 0, pat2 = 0] = clean(v2);
    if (maj1 !== maj2) return maj1 > maj2 ? 1 : -1;
    if (min1 !== min2) return min1 > min2 ? 1 : -1;
    if (pat1 !== pat2) return pat1 > pat2 ? 1 : -1;
    return 0;
  },

  checkVersionCompatibility(appInfo, currentVersion = null) {
    const current = currentVersion || this.getCurrentVersion();
    if (!appInfo || typeof appInfo !== 'object') {
      return { status: 'unknown', currentVersion: current };
    }

    const minVer = appInfo.minVersion ? String(appInfo.minVersion).trim() : null;
    const depVer = appInfo.deprecatedVersion ? String(appInfo.deprecatedVersion).trim() : null;
    const latVer = appInfo.latestVersion ? String(appInfo.latestVersion).trim() : null;
    const downloadUrl = appInfo.downloadUrl || 'https://github.com/ebelt9hf/The_Secretary';
    const releaseNotes = appInfo.releaseNotes || '';

    // 1. Check declined / minimum required version
    if (minVer && this.compareSemver(current, minVer) < 0) {
      return {
        status: 'declined',
        currentVersion: current,
        minVersion: minVer,
        latestVersion: latVer || minVer,
        downloadUrl,
        releaseNotes
      };
    }

    // 2. Check deprecation warning
    if (depVer && this.compareSemver(current, depVer) <= 0) {
      return {
        status: 'deprecated',
        currentVersion: current,
        deprecatedVersion: depVer,
        latestVersion: latVer || depVer,
        downloadUrl,
        releaseNotes
      };
    }

    // 3. Check if new version update available
    if (latVer && this.compareSemver(current, latVer) < 0) {
      return {
        status: 'update_available',
        currentVersion: current,
        latestVersion: latVer,
        downloadUrl,
        releaseNotes
      };
    }

    return {
      status: 'up_to_date',
      currentVersion: current,
      latestVersion: latVer || current,
      downloadUrl,
      releaseNotes
    };
  },

  applyVersionStatus(versionResult) {
    this.state.versionStatus = versionResult;
    if (versionResult && versionResult.status === 'declined') {
      this.state.status = this.STATUS.DECLINED;
      if (this._remoteUnsubscribe) {
        this._remoteUnsubscribe();
        this._remoteUnsubscribe = null;
      }
      this._notifyStatus('Version below minimum required version. Cloud sync declined.');
    }
    for (const listener of this._versionListeners) {
      try { listener(versionResult); } catch (e) { console.warn('Version listener error', e); }
    }
  },

  onVersionChange(listener) {
    if (typeof listener === 'function') {
      this._versionListeners.add(listener);
      if (this.state.versionStatus) {
        try { listener(this.state.versionStatus); } catch (e) {}
      }
    }
    return () => this._versionListeners.delete(listener);
  },

  listenAppVersion() {
    const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);
    if (!bridge || typeof bridge.listenAppInfo !== 'function') return () => {};

    const defaultCfg = typeof window !== 'undefined' ? window.DEFAULT_FIREBASE_CONFIG : (typeof globalThis !== 'undefined' ? globalThis.DEFAULT_FIREBASE_CONFIG : null);
    if (defaultCfg && !bridge.app && typeof bridge.init === 'function') {
      bridge.init(defaultCfg);
    }

    if (this._versionUnsubscribe) {
      this._versionUnsubscribe();
      this._versionUnsubscribe = null;
    }

    this._versionUnsubscribe = bridge.listenAppInfo(
      (appInfo) => {
        const result = this.checkVersionCompatibility(appInfo);
        this.applyVersionStatus(result);
      },
      (err) => {
        console.warn('listenAppInfo error:', err);
      }
    );

    return this._versionUnsubscribe;
  },

  // ── Sync Code (Pairing Key) Helpers ──
  generateSyncCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let p1 = '';
    let p2 = '';
    for (let i = 0; i < 4; i++) {
      p1 += chars.charAt(Math.floor(Math.random() * chars.length));
      p2 += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `SEC-${p1}-${p2}`;
  },

  // ── Master Passphrase Generator & Clarity Helpers ──
  generateDefaultPassphrase() {
    const wordList = [
      'aurora', 'beacon', 'citadel', 'cobalt', 'canyon', 'crystal',
      'drift', 'echo', 'ember', 'falcon', 'flint', 'fortress',
      'glacier', 'granite', 'harbor', 'horizon', 'ironclad', 'jupiter',
      'kinetic', 'lunar', 'matrix', 'monarch', 'nebula', 'nexus',
      'obsidian', 'orbit', 'paragon', 'phoenix', 'prism', 'pulsar',
      'quantum', 'quartz', 'radium', 'safari', 'sapphire', 'sentinel',
      'shadow', 'shield', 'silver', 'solace', 'solstice', 'stellar',
      'stride', 'summit', 'tempest', 'timber', 'tundra', 'valiant',
      'vector', 'velvet', 'vortex', 'zephyr', 'zenith'
    ];
    let rand = [];
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buf = new Uint32Array(6);
      crypto.getRandomValues(buf);
      rand = Array.from(buf);
    } else {
      rand = Array.from({ length: 6 }, () => Math.floor(Math.random() * 1000000));
    }
    const words = [];
    for (let i = 0; i < 5; i++) {
      words.push(wordList[rand[i] % wordList.length]);
    }
    const suffix = (rand[5] % 9000) + 1000;
    return `${words.join('-')}-${suffix}`;
  },

  evaluatePassphraseStrength(passphrase) {
    const pass = typeof passphrase === 'string' ? passphrase : '';
    const len = pass.length;
    if (len === 0) {
      return { score: 'empty', length: 0, textKey: 'sync.badgeTooShort' };
    }
    if (len < 10) {
      return { score: 'too_short', length: len, textKey: 'sync.badgeTooShort' };
    }
    if (len < 20) {
      return { score: 'acceptable', length: len, textKey: 'sync.badgeAcceptable' };
    }
    if (len < 35) {
      return { score: 'strong', length: len, textKey: 'sync.badgeStrong' };
    }
    return { score: 'ultra', length: len, textKey: 'sync.badgeUltraSecure' };
  },

  getSyncCode() {
    if (this.state.userId && this.state.userId !== 'default_user') {
      return this.state.userId;
    }
    if (typeof settings !== 'undefined' && settings?.vaultId) {
      return settings.vaultId;
    }
    return null;
  },

  setSyncCode(code) {
    if (!code) return;
    const clean = code.trim().toUpperCase();
    this.state.userId = clean;
    if (typeof settings !== 'undefined' && settings) {
      settings.vaultId = clean;
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
    }
  },

  async linkExistingVault(syncCode, passphrase, config = {}) {
    if (this.state.status === this.STATUS.DECLINED) {
      throw new Error(typeof t === 'function' ? t('sync.statusDeclinedTooltip') : 'Cloud sync is disabled because your Secretary version is below the minimum supported version.');
    }
    if (!syncCode || !syncCode.trim()) {
      throw new Error(typeof t === 'function' ? t('sync.syncCodeRequired') : 'Sync code is required');
    }
    if (!passphrase || passphrase.length < 10) {
      throw new Error(typeof t === 'function' ? t('sync.passphraseTooShort') : 'Master passphrase must be at least 10 characters long');
    }

    const cleanCode = syncCode.trim().toUpperCase();
    this.setSyncCode(cleanCode);

    await this.ensureBridgeInitialized(config);
    const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);
    if (!bridge) {
      throw new Error('Firebase connection not available');
    }

    // 1. Fetch remote vault metadata
    const remoteMeta = await bridge.getVaultMeta(cleanCode);
    if (!remoteMeta || !remoteMeta.salt) {
      throw new Error(typeof t === 'function' ? t('sync.syncCodeNotFound') : 'Sync Code not found in cloud. Please check the code.');
    }

    if (!this.validateSchemaCompatibility(remoteMeta)) {
      const msg = typeof t === 'function'
        ? t('sync.unsupportedSchemaVersion').replace('{schemaVersion}', remoteMeta.schemaVersion).replace('{supportedVersion}', this.SCHEMA_VERSION)
        : `This vault uses database schema v${remoteMeta.schemaVersion}, which is newer than your Secretary version supports (v${this.SCHEMA_VERSION}). Please update Secretary.`;
      throw new Error(msg);
    }

    // 2. Verify master passphrase against remote canary
    const check = await CryptoEngine.verifyPassphrase(passphrase, remoteMeta);
    if (!check.valid || !check.key) {
      throw new Error(typeof t === 'function' ? t('sync.incorrectPassphrase') : 'Incorrect master passphrase');
    }

    this.state.vaultMeta = remoteMeta;
    this.state.masterKey = check.key;
    this.state.isUnlocked = true;
    this.state.engine = 'firebase';
    this.state.status = this.STATUS.SYNCED;

    try {
      await VaultIDBStorage.saveMeta('vault_meta', remoteMeta);
    } catch (e) {}

    if (typeof settings !== 'undefined' && settings) {
      settings.vaultId = cleanCode;
      settings.vaultMeta = remoteMeta;
      settings.storageEngine = 'firebase';
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
    }

    // 3. Fetch all remote encrypted notes
    const remoteNotes = await bridge.getAllNotes(cleanCode);
    let linkedCount = 0;
    if (Array.isArray(remoteNotes)) {
      for (const rDoc of remoteNotes) {
        if (!rDoc || !rDoc.id) continue;
        const cleanId = this._normalizeId(rDoc.id);
        if (!this.validateSchemaCompatibility(rDoc)) {
          console.warn(`[FirebaseSyncService] Skipping remote note ${cleanId}: requires newer schema v${rDoc.schemaVersion}`);
          continue;
        }
        if (rDoc.deleted) {
          this.state.localCache.set(cleanId, rDoc);
          if (this.state.manifestCache) this.state.manifestCache.delete(cleanId);
          try { await VaultIDBStorage.putNote(rDoc); } catch (e) {}
        } else if (rDoc.ciphertext) {
          try {
            const dec = await CryptoEngine.decryptData(check.key, {
              iv: rDoc.iv,
              ciphertext: rDoc.ciphertext
            });
            if (dec) {
              this.state.localCache.set(cleanId, rDoc);
              this._updateManifestCache(cleanId, dec);
              try { await VaultIDBStorage.putNote(rDoc); } catch (e) {}
              linkedCount++;
            }
          } catch (e) {
            console.warn(`Failed to decrypt note ${cleanId}:`, e);
          }
        }
      }
    }

    // Persist manifest cache
    try {
      await VaultIDBStorage.saveMeta('manifest_cache', Array.from(this.state.manifestCache.values()));
    } catch (e) {}

    // 4. Start real-time cloud listening
    this.listenRemoteVault();

    if (typeof window.StorageAPI !== 'undefined') {
      window.StorageAPI.setStorageEngine('firebase');
    }

    this._notifyStatus('Linked to vault');
    return { linkedCount, syncCode: cleanCode };
  },

  // ── Vault Setup & Unlock Lifecycle ──
  async loadPersistedVaultMeta() {
    if (typeof settings !== 'undefined' && settings?.vaultId) {
      this.state.userId = settings.vaultId;
    }

    if (this.state.vaultMeta && this.state.vaultMeta.salt) {
      return this.state.vaultMeta;
    }

    // 1. Try loading from IndexedDB
    try {
      const idbMeta = await VaultIDBStorage.getMeta('vault_meta');
      if (idbMeta && idbMeta.salt) {
        this.state.vaultMeta = idbMeta;
        return idbMeta;
      }
    } catch (e) {
      console.warn('Failed to load vault meta from IndexedDB', e);
    }

    // 2. Try loading from settings.vaultMeta
    if (typeof settings !== 'undefined' && settings?.vaultMeta) {
      this.state.vaultMeta = settings.vaultMeta;
      return settings.vaultMeta;
    }

    return null;
  },

  // ── Remembered passphrase: OS keychain only (Electron safeStorage). ──
  // Never persisted in the browser (IndexedDB/localStorage) and never held in memory after unlock.
  _securePassphraseAPI() {
    return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.securePassphrase) || null;
  },

  async isPassphraseStorageAvailable() {
    const api = this._securePassphraseAPI();
    if (!api) return false;
    try {
      return !!(await api.isAvailable());
    } catch (e) {
      return false;
    }
  },

  /** Removes passphrases stored by earlier builds (XOR-obfuscated in IndexedDB / localStorage). */
  async purgeLegacyPassphraseStorage() {
    let ok = true;
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem('secretary_saved_passphrase');
    } catch (e) { ok = false; }
    try {
      const db = await VaultIDBStorage.getDB();
      if (db && (await VaultIDBStorage.deleteMeta('saved_passphrase')) === false) ok = false;
    } catch (e) { ok = false; }
    return ok;
  },

  async savePassphraseLocally(passphrase) {
    if (!passphrase || typeof passphrase !== 'string') return false;
    const api = this._securePassphraseAPI();
    if (!api || !(await this.isPassphraseStorageAvailable())) return false;
    let saved = false;
    try {
      saved = !!(await api.save(passphrase));
    } catch (e) {
      console.warn('Failed to save passphrase to OS keychain', e);
    }
    if (saved && typeof settings === 'object' && settings) {
      settings.rememberPassphrase = true;
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
    }
    return saved;
  },

  async getSavedPassphrase() {
    const api = this._securePassphraseAPI();
    if (!api) return null;
    try {
      return (await api.get()) || null;
    } catch (e) {
      console.warn('Failed to read passphrase from OS keychain', e);
      return null;
    }
  },

  /** Returns true only when every stored copy (keychain + legacy) was actually removed. */
  async clearSavedPassphrase() {
    let ok = await this.purgeLegacyPassphraseStorage();
    const api = this._securePassphraseAPI();
    if (api) {
      try {
        if (!(await api.clear())) ok = false;
      } catch (e) {
        console.warn('Failed to clear passphrase from OS keychain', e);
        ok = false;
      }
    }
    if (typeof settings === 'object' && settings) {
      settings.rememberPassphrase = false;
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
    }
    return ok;
  },

  async hasSavedPassphrase() {
    if (typeof settings !== 'object' || !settings || settings.rememberPassphrase !== true) return false;
    return !!(await this.getSavedPassphrase());
  },

  async setupVault(passphrase, config = {}) {
    if (this.state.status === this.STATUS.DECLINED) {
      throw new Error(typeof t === 'function' ? t('sync.statusDeclinedTooltip') : 'Cloud sync is disabled because your Secretary version is below the minimum supported version.');
    }
    if (typeof CryptoEngine === 'undefined') {
      throw new Error('CryptoEngine is required for Firebase E2EE');
    }

    const targetCode = config.syncCode || config.vaultId || (this.state.userId && this.state.userId !== 'default_user' ? this.state.userId : null) || (typeof settings !== 'undefined' && settings?.vaultId) || this.generateSyncCode();
    this.setSyncCode(targetCode);

    const { vaultMeta, key } = await CryptoEngine.setupVault(passphrase);
    vaultMeta.schemaVersion = this.SCHEMA_VERSION;
    vaultMeta.appVersion = this.getCurrentVersion();
    this.state.config = config;
    this.state.vaultMeta = vaultMeta;
    this.state.masterKey = key;
    this.state.isUnlocked = true;
    this.state.status = this.STATUS.SYNCED;
    this.state.lastSyncTimestamp = Date.now();
    this.state.localCache = new Map();
    this.state.manifestCache = new Map();
    this.state.pendingQueue = new Map();
    if (this.state.docsCache) this.state.docsCache.clear();
    if (this.state.encryptedDocs) this.state.encryptedDocs.clear();
    if (this.state.assetsCache) this.state.assetsCache.clear();
    if (this.state.encryptedAssets) this.state.encryptedAssets.clear();

    try {
      await VaultIDBStorage.clearStore('notes');
      await VaultIDBStorage.clearStore('docs');
      await VaultIDBStorage.clearStore('assets');
      await VaultIDBStorage.clearWAL();
      await VaultIDBStorage.deleteMeta('manifest_cache');
    } catch (e) {}

    // Persist vaultMeta to IndexedDB and settings
    try {
      await VaultIDBStorage.saveMeta('vault_meta', vaultMeta);
    } catch (e) {
      console.warn('Failed to save vaultMeta to IndexedDB', e);
    }
    if (typeof settings !== 'undefined' && settings) {
      settings.vaultMeta = vaultMeta;
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
    }

    await this.ensureBridgeInitialized(config);
    const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);
    if (bridge && this.state.userId && this.state.userId !== 'default_user') {
      try {
        await bridge.saveVaultMeta(this.state.userId, vaultMeta);
      } catch (e) {
        console.warn('Could not save vaultMeta to cloud:', e);
      }
    }
    SyncBroadcastBus.init(this);
    this.setupLifecycleFlush();
    await this._recoverFromWAL();
    this.listenRemoteVault();

    this._notifyStatus();
    return { vaultMeta, key, syncCode: targetCode };
  },

  async unlockVault(passphrase, vaultMeta = null, config = null) {
    if (this.state.status === this.STATUS.DECLINED) {
      throw new Error(typeof t === 'function' ? t('sync.statusDeclinedTooltip') : 'Cloud sync is disabled because your Secretary version is below the minimum supported version.');
    }
    if (typeof CryptoEngine === 'undefined') {
      throw new Error('CryptoEngine is required for Firebase E2EE');
    }

    let meta = vaultMeta || this.state.vaultMeta;
    if (!meta) {
      meta = await this.loadPersistedVaultMeta();
    }
    await this.ensureBridgeInitialized(config);
    const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);
    if (!meta && bridge && this.state.userId && this.state.userId !== 'default_user') {
      try {
        meta = await bridge.getVaultMeta(this.state.userId);
      } catch (e) {}
    }
    if (!meta) {
      throw new Error('No vault metadata found');
    }

    const check = await CryptoEngine.verifyPassphrase(passphrase, meta);
    if (!check.valid || !check.key) {
      this.state.status = this.STATUS.LOCKED;
      this.state.lastError = 'Incorrect passphrase';
      this._notifyStatus('Incorrect passphrase');
      return false;
    }

    if (config) this.state.config = config;
    this.state.vaultMeta = meta;
    this.state.masterKey = check.key;
    this.state.isUnlocked = true;
    this.state.status = this.STATUS.SYNCED;
    this.state.lastError = null;

    // 1. Hydrate localCache from IndexedDB if in-memory cache is empty
    if (this.state.localCache.size === 0) {
      try {
        const idbNotes = await VaultIDBStorage.getAllNotes();
        for (const n of idbNotes) {
          if (n && n.id) {
            this.state.localCache.set(n.id, n);
          }
        }
      } catch (err) {
        console.warn('Failed to hydrate notes from IndexedDB', err);
      }
    }

    // 2. Hydrate manifestCache from IndexedDB without decrypting notes
    try {
      const cachedManifest = await VaultIDBStorage.getMeta('manifest_cache');
      if (Array.isArray(cachedManifest) && cachedManifest.length > 0) {
        for (const m of cachedManifest) {
          if (m && m.id) {
            this.state.manifestCache.set(m.id, m);
          }
        }
      } else if (this.state.localCache.size > 0 && this.state.manifestCache.size === 0) {
        // Asynchronously populate manifest cache in background without blocking UI
        setTimeout(async () => {
          for (const [id, docRecord] of this.state.localCache.entries()) {
            if (docRecord && !docRecord.deleted && docRecord.ciphertext && !this.state.manifestCache.has(id)) {
              try {
                const dec = await CryptoEngine.decryptData(this.state.masterKey, {
                  iv: docRecord.iv,
                  ciphertext: docRecord.ciphertext
                });
                this._updateManifestCache(id, dec);
              } catch (e) {}
            }
          }
          try {
            await VaultIDBStorage.saveMeta('manifest_cache', Array.from(this.state.manifestCache.values()));
          } catch (e) {}
        }, 100);
      }
    } catch (e) {
      console.warn('Failed to load cached manifest', e);
    }

    SyncBroadcastBus.init(this);
    this.setupLifecycleFlush();
    await this._recoverFromWAL();

    this.listenRemoteVault();
    setTimeout(() => {
      if (this.state.isUnlocked) {
        this.repairManifestTitles().catch(() => {});
      }
    }, 300);
    this._notifyStatus('Vault unlocked');
    return true;
  },

  lockVault() {
    if (this._remoteUnsubscribe) {
      this._remoteUnsubscribe();
      this._remoteUnsubscribe = null;
    }
    if (this._remoteDocsUnsubscribe) {
      this._remoteDocsUnsubscribe();
      this._remoteDocsUnsubscribe = null;
    }
    this.state.masterKey = null;
    this.state.isUnlocked = false;
    if (this.state.docsCache) this.state.docsCache.clear();
    if (this.state.assetsCache) this.state.assetsCache.clear();
    this.state.status = this.STATUS.LOCKED;
    this._notifyStatus('Vault locked');
  },

  async rotatePassphrase(oldPass, newPass) {
    if (!this.state.isUnlocked || !this.state.masterKey) {
      throw new Error('Vault must be unlocked to rotate passphrase');
    }

    const encryptedList = Array.from(this.state.localCache.values());
    const { newVaultMeta, newKey, reEncryptedNotes } = await CryptoEngine.rotateVaultPassphrase(
      oldPass,
      newPass,
      this.state.vaultMeta,
      encryptedList
    );

    newVaultMeta.schemaVersion = this.SCHEMA_VERSION;
    newVaultMeta.appVersion = this.getCurrentVersion();

    const oldVaultMeta = this.state.vaultMeta;
    this.state.vaultMeta = newVaultMeta;
    this.state.masterKey = newKey;
    try {
      if (await this.hasSavedPassphrase()) {
        const saved = await this.savePassphraseLocally(newPass);
        // Never leave a stale (now wrong) passphrase on disk if re-saving failed
        if (!saved) await this.clearSavedPassphrase();
      }
    } catch (e) {
      console.warn('Failed to refresh saved passphrase after rotation', e);
      await this.clearSavedPassphrase();
    }

    try {
      await VaultIDBStorage.saveMeta('vault_meta', newVaultMeta);
    } catch (e) {
      console.warn('Failed to save rotated vaultMeta to IndexedDB', e);
    }
    if (typeof settings !== 'undefined' && settings) {
      settings.vaultMeta = newVaultMeta;
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
    }

    const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);

    // Re-encrypt notes
    for (const note of reEncryptedNotes) {
      this.state.localCache.set(note.id, note);
      this.state.pendingQueue.set(note.id, note);
      try {
        await VaultIDBStorage.putNote(note);
      } catch (e) {
        console.warn('Failed to update note in IndexedDB', e);
      }
    }

    // Re-encrypt docs store
    try {
      const oldDerivedKey = await CryptoEngine.deriveKey(oldPass, oldVaultMeta.salt, oldVaultMeta.kdfIterations || 100000);
      const docsMap = new Map(this.state.encryptedDocs || []);
      try {
        const idbDocs = await VaultIDBStorage.getAllRecords('docs');
        for (const d of idbDocs) {
          if (d && d.id) docsMap.set(d.id, d);
        }
      } catch (e) {}

      for (const [id, d] of docsMap.entries()) {
        if (!d || d.deleted || !d.ciphertext) continue;
        try {
          const dec = await CryptoEngine.decryptData(oldDerivedKey, { iv: d.iv, ciphertext: d.ciphertext });
          if (dec) {
            const reEnc = await CryptoEngine.encryptData(newKey, dec);
            const updatedRecord = { ...d, iv: reEnc.iv, ciphertext: reEnc.ciphertext, updatedAt: Date.now() };
            if (!this.state.encryptedDocs) this.state.encryptedDocs = new Map();
            this.state.encryptedDocs.set(id, updatedRecord);
            try { await VaultIDBStorage.putRecord('docs', updatedRecord); } catch (e) {}
            const val = dec.data !== undefined ? dec.data : dec;
            if (this.state.docsCache) this.state.docsCache.set(id, val);
            if (bridge && this.state.userId && this.state.userId !== 'default_user' && typeof bridge.saveDoc === 'function') {
              try { await bridge.saveDoc(this.state.userId, id, updatedRecord); } catch (e) {}
            }
          }
        } catch (err) {
          console.warn(`Failed to re-encrypt doc ${id} during passphrase rotation`, err);
        }
      }
    } catch (docRotErr) {
      console.warn('Failed to rotate docs encryption', docRotErr);
    }

    // Re-encrypt assets store
    try {
      const oldDerivedKey = await CryptoEngine.deriveKey(oldPass, oldVaultMeta.salt, oldVaultMeta.kdfIterations || 100000);
      const assetsMap = new Map(this.state.encryptedAssets || []);
      try {
        const idbAssets = await VaultIDBStorage.getAllRecords('assets');
        for (const a of idbAssets) {
          if (a && a.id) assetsMap.set(a.id, a);
        }
      } catch (e) {}

      for (const [id, a] of assetsMap.entries()) {
        if (!a || a.deleted || !a.ciphertext) continue;
        try {
          const dec = await CryptoEngine.decryptData(oldDerivedKey, { iv: a.iv, ciphertext: a.ciphertext });
          if (dec) {
            const reEnc = await CryptoEngine.encryptData(newKey, dec);
            const updatedRecord = { ...a, iv: reEnc.iv, ciphertext: reEnc.ciphertext, updatedAt: Date.now() };
            if (!this.state.encryptedAssets) this.state.encryptedAssets = new Map();
            this.state.encryptedAssets.set(id, updatedRecord);
            try { await VaultIDBStorage.putRecord('assets', updatedRecord); } catch (e) {}
            if (this.state.assetsCache) this.state.assetsCache.set(id, dec);
            if (bridge && this.state.userId && this.state.userId !== 'default_user' && typeof bridge.saveAsset === 'function') {
              try { await bridge.saveAsset(this.state.userId, id, updatedRecord); } catch (e) {}
            }
          }
        } catch (err) {
          console.warn(`Failed to re-encrypt asset ${id} during passphrase rotation`, err);
        }
      }
    } catch (assetRotErr) {
      console.warn('Failed to rotate assets encryption', assetRotErr);
    }

    // Clear old WAL entries to prevent stale pre-rotation keys from being replayed
    try {
      await VaultIDBStorage.clearWAL();
    } catch (e) {}

    this.state.lastSyncTimestamp = Date.now();
    if (bridge && this.state.userId && this.state.userId !== 'default_user') {
      try {
        await bridge.saveVaultMeta(this.state.userId, newVaultMeta);
      } catch (e) {
        console.warn('Could not update rotated vaultMeta in Firebase:', e);
      }
    }
    this._notifyStatus('Passphrase rotated');
    return newVaultMeta;
  },

  // ── High Performance CRUD on Local Firestore Cache ──
  _normalizeId(noteId) {
    if (!noteId) return '';
    let cleaned = String(noteId)
      .trim()
      .replace(/\\/g, '/')
      .replace(/^notes\//i, '')
      .replace(/\.html$/i, '')
      .replace(/\.\./g, '') // remove directory traversal tokens
      .replace(/[^a-zA-Z0-9_\-\.]/g, '_'); // sanitize to safe characters

    // Prevent __proto__, prototype, constructor, double-dot or Firestore reserved __.*__ prefixes
    if (/^__.*__$/.test(cleaned) || cleaned === '__proto__' || cleaned === 'prototype' || cleaned === 'constructor' || cleaned === '.' || cleaned === '..' || !cleaned) {
      cleaned = 'sanitized_note_' + Math.random().toString(36).slice(2, 8);
    }
    return cleaned;
  },

  async saveNote(id, contentHtml, noteData = {}) {
    return await this.queueSyncNote({
      id,
      contentHtml,
      ...noteData
    }, 0);
  },

  async queueSyncNote(noteData, debounceMs = 5000) {
    if (this.state.status === this.STATUS.DECLINED) {
      console.warn('FirebaseSyncService: cannot sync note, app version is declined');
      return;
    }
    if (!noteData || !noteData.id) return;
    if (!this.state.isUnlocked || !this.state.masterKey) {
      console.warn('FirebaseSyncService: cannot sync note while vault is locked');
      return;
    }

    const cleanId = this._normalizeId(noteData.id);
    const contentHtml = noteData.contentHtml !== undefined ? noteData.contentHtml : (noteData.html || '');
    const bodyHash = this._hashContent(contentHtml);
    const now = noteData.updatedAt || Date.now();
    const isDummy = (t, id) => !t || t === id || t === 'Untitled' || t === 'Untitled Note' || /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(t) || /^note[-_]/.test(t);
    let resolvedTitle = noteData.title || 'Untitled';
    if (isDummy(resolvedTitle, cleanId) && contentHtml) {
      const titleMatch = contentHtml.match(/<title[^>]*>([^<]+)<\/title>/i) || contentHtml.match(/<h1[^>]*class=["'][^"']*title[^"']*["'][^>]*>([^<]+)<\/h1>/i) || contentHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      if (titleMatch && titleMatch[1]?.trim() && !isDummy(titleMatch[1].trim(), cleanId)) {
        resolvedTitle = titleMatch[1].trim();
      }
    }

    const metaPayload = {
      id: cleanId,
      path: noteData.path || `notes/${cleanId}.html`,
      title: resolvedTitle,
      date: noteData.date || '',
      tags: Array.isArray(noteData.tags) ? noteData.tags : [],
      workstream: noteData.workstream || '',
      pinned: !!noteData.pinned,
      archived: !!noteData.archived,
      favorite: !!noteData.favorite,
      bodyHash,
      updatedAt: now,
      deleted: false,
      schemaVersion: this.SCHEMA_VERSION,
      appVersion: this.getCurrentVersion()
    };

    let existingRecord = this.state.localCache.get(cleanId);
    if (!existingRecord) {
      try { existingRecord = await VaultIDBStorage.getNote(cleanId); } catch (e) {}
    }

    let bodyChanged = true;
    if (existingRecord) {
      if (existingRecord.bodyHash === bodyHash || existingRecord.contentHtml === contentHtml) {
        bodyChanged = false;
      }
    }

    // 1. Plaintext Local Working Document (0ms local latency, sub-ms indexing)
    const docRecord = {
      ...metaPayload,
      contentHtml,
      html: contentHtml
    };

    // 2. Write to in-memory L1 Cache & persistent IndexedDB L2 Cache in plaintext
    this.state.localCache.set(cleanId, docRecord);
    this._updateManifestCache(cleanId, metaPayload);

    // Queue for wire encryption & cloud sync
    const pendingItem = {
      id: cleanId,
      metaPayload,
      contentHtml,
      bodyChanged,
      updatedAt: now,
      deleted: false
    };
    this.state.pendingQueue.set(cleanId, pendingItem);
    this.state.status = this.STATUS.SYNCING;
    this._notifyStatus();

    // Append to Write-Ahead Log (WAL)
    const walId = `wal_note_${cleanId}_${now}`;
    try {
      await VaultIDBStorage.appendWAL({
        id: walId,
        type: 'note',
        targetId: cleanId,
        payload: {
          cleanId,
          metaPayload,
          docRecord,
          pendingItem
        },
        timestamp: now
      });
    } catch (e) {}

    // Broadcast update across open windows/tabs via local bus
    SyncBroadcastBus.broadcast('NOTE_UPDATED', {
      cleanId,
      docRecord,
      metaPayload
    });

    try {
      await VaultIDBStorage.putNote(docRecord);
    } catch (e) {
      console.warn('Failed to persist note in IndexedDB', e);
    }

    // 3. Debounce Cloud Upload
    if (this.state.syncTimer) clearTimeout(this.state.syncTimer);
    if (debounceMs <= 0) {
      await this.flushQueue();
    } else {
      this.state.syncTimer = setTimeout(() => this.flushQueue(), debounceMs);
    }
  },

  async updateNoteMetadata(noteId, metaUpdates = {}, debounceMs = 5000) {
    const cleanId = this._normalizeId(noteId);
    if (!cleanId || !this.state.isUnlocked || !this.state.masterKey) return;

    let existingRecord = this.state.localCache.get(cleanId);
    if (!existingRecord) {
      try { existingRecord = await VaultIDBStorage.getNote(cleanId); } catch (e) {}
    }
    if (!existingRecord) return;

    let existingMeta = existingRecord;
    if (existingRecord.meta?.ciphertext || existingRecord.ciphertext) {
      try {
        const dec = await CryptoEngine.decryptData(this.state.masterKey, {
          iv: existingRecord.meta?.iv || existingRecord.iv,
          ciphertext: existingRecord.meta?.ciphertext || existingRecord.ciphertext
        });
        if (dec) existingMeta = dec;
      } catch (e) {}
    }

    const now = Date.now();
    const updatedMetaPayload = {
      ...existingMeta,
      ...metaUpdates,
      id: cleanId,
      path: existingMeta.path || `notes/${cleanId}.html`,
      updatedAt: now,
      deleted: false,
      schemaVersion: this.SCHEMA_VERSION,
      appVersion: this.getCurrentVersion()
    };

    const updatedDocRecord = {
      ...existingRecord,
      ...updatedMetaPayload
    };

    this.state.localCache.set(cleanId, updatedDocRecord);
    this._updateManifestCache(cleanId, updatedMetaPayload);

    const pendingItem = {
      id: cleanId,
      metaPayload: updatedMetaPayload,
      contentHtml: updatedDocRecord.contentHtml || updatedDocRecord.html || '',
      bodyChanged: false,
      updatedAt: now,
      deleted: false
    };
    this.state.pendingQueue.set(cleanId, pendingItem);
    this.state.status = this.STATUS.SYNCING;
    this._notifyStatus();

    // Append to WAL
    const walId = `wal_meta_${cleanId}_${now}`;
    try {
      await VaultIDBStorage.appendWAL({
        id: walId,
        type: 'meta',
        targetId: cleanId,
        payload: {
          cleanId,
          updatedMetaPayload,
          updatedDocRecord,
          pendingItem
        },
        timestamp: now
      });
    } catch (e) {}

    // Broadcast update across open windows/tabs
    SyncBroadcastBus.broadcast('NOTE_UPDATED', {
      cleanId,
      docRecord: updatedDocRecord,
      metaPayload: updatedMetaPayload
    });

    try {
      await VaultIDBStorage.putNote(updatedDocRecord);
    } catch (e) {
      console.warn('Failed to persist note metadata in IndexedDB', e);
    }

    if (this.state.syncTimer) clearTimeout(this.state.syncTimer);
    if (debounceMs <= 0) {
      await this.flushQueue();
    } else {
      this.state.syncTimer = setTimeout(() => this.flushQueue(), debounceMs);
    }
  },

  async deleteNote(noteId, debounceMs = 5000) {
    const cleanId = this._normalizeId(noteId);
    if (!cleanId) return;
    if (!this.state.isUnlocked || !this.state.masterKey) return;

    const now = Date.now();
    const docRecord = {
      id: cleanId,
      deleted: true,
      updatedAt: now,
      schemaVersion: this.SCHEMA_VERSION,
      appVersion: this.getCurrentVersion()
    };

    this.state.localCache.set(cleanId, docRecord);
    if (this.state.manifestCache) {
      this.state.manifestCache.delete(cleanId);
    }
    this.state.pendingQueue.set(cleanId, docRecord);
    this.state.status = this.STATUS.SYNCING;
    this._notifyStatus();

    // Append deletion to WAL
    const walId = `wal_del_${cleanId}_${now}`;
    try {
      await VaultIDBStorage.appendWAL({
        id: walId,
        type: 'delete_note',
        targetId: cleanId,
        payload: {
          cleanId,
          docRecord
        },
        timestamp: now
      });
    } catch (e) {}

    // Broadcast deletion
    SyncBroadcastBus.broadcast('NOTE_DELETED', { cleanId });

    try {
      await VaultIDBStorage.putNote(docRecord);
    } catch (e) {
      console.warn('Failed to update note deletion in IndexedDB', e);
    }

    if (debounceMs <= 0) {
      await this.flushQueue();
    } else {
      if (this.state.syncTimer) clearTimeout(this.state.syncTimer);
      this.state.syncTimer = setTimeout(() => this.flushQueue(), debounceMs);
    }
  },

  async hasNote(noteId) {
    if (!this.state.isUnlocked) return false;
    const cleanId = this._normalizeId(noteId);
    if (this.state.localCache.has(cleanId)) {
      const doc = this.state.localCache.get(cleanId);
      return !!(doc && !doc.deleted && (!doc.meta || !doc.meta.deleted));
    }
    if (this.state.manifestCache && this.state.manifestCache.has(cleanId)) {
      return true;
    }
    try {
      const doc = await VaultIDBStorage.getNote(cleanId);
      return !!(doc && !doc.deleted && (!doc.meta || !doc.meta.deleted));
    } catch (e) {
      return false;
    }
  },

  async getNote(noteId) {
    if (!this.state.isUnlocked || !this.state.masterKey) return null;
    const cleanId = this._normalizeId(noteId);
    let docRecord = this.state.localCache.get(cleanId) || this.state.localCache.get(noteId);

    if (!docRecord) {
      try {
        docRecord = await VaultIDBStorage.getNote(cleanId);
        if (docRecord) {
          this.state.localCache.set(cleanId, docRecord);
        }
      } catch (e) {}
    }

    if (!docRecord) return null;
    if (docRecord.deleted || (docRecord.meta && docRecord.meta.deleted)) return null;

    // Plaintext local note: instant return with 0ms crypto overhead
    if (docRecord.contentHtml !== undefined && !docRecord.meta?.ciphertext && !docRecord.ciphertext) {
      this._updateManifestCache(cleanId, docRecord);
      return docRecord;
    }

    // Schema v2: 2-Tier note (legacy or remote encrypted)
    if (docRecord.meta && docRecord.meta.ciphertext) {
      try {
        const decryptedMeta = await CryptoEngine.decryptData(this.state.masterKey, {
          iv: docRecord.meta.iv,
          ciphertext: docRecord.meta.ciphertext
        });
        if (!decryptedMeta) return null;

        let contentHtml = '';
        if (docRecord.body && docRecord.body.ciphertext) {
          try {
            const decryptedBody = await CryptoEngine.decryptData(this.state.masterKey, {
              iv: docRecord.body.iv,
              ciphertext: docRecord.body.ciphertext
            });
            if (decryptedBody) {
              contentHtml = decryptedBody.contentHtml !== undefined ? decryptedBody.contentHtml : (decryptedBody.html || '');
            }
          } catch (be) {
            console.warn(`Failed to decrypt note body ${cleanId}`, be);
          }
        } else {
          // Lazy fetch remote body if not yet cached
          const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);
          if (bridge && this.state.userId && this.state.userId !== 'default_user' && typeof bridge.getNoteBody === 'function') {
            try {
              const remoteBody = await bridge.getNoteBody(this.state.userId, cleanId);
              if (remoteBody && remoteBody.ciphertext) {
                const decBody = await CryptoEngine.decryptData(this.state.masterKey, {
                  iv: remoteBody.iv,
                  ciphertext: remoteBody.ciphertext
                });
                if (decBody) {
                  contentHtml = decBody.contentHtml !== undefined ? decBody.contentHtml : (decBody.html || '');
                }
              }
            } catch (rbe) {}
          }
        }

        const fullNote = {
          ...decryptedMeta,
          id: cleanId,
          path: decryptedMeta.path || `notes/${cleanId}.html`,
          contentHtml,
          html: contentHtml
        };
        this.state.localCache.set(cleanId, fullNote);
        try { await VaultIDBStorage.putNote(fullNote); } catch (e) {}
        this._updateManifestCache(cleanId, fullNote);
        return fullNote;
      } catch (e) {
        console.warn(`Failed to decrypt note meta ${cleanId}`, e);
        return null;
      }
    }

    // Schema v1 legacy note
    if (docRecord.ciphertext) {
      try {
        const decrypted = await CryptoEngine.decryptData(this.state.masterKey, {
          iv: docRecord.iv,
          ciphertext: docRecord.ciphertext
        });
        if (decrypted) {
          const fullNote = {
            ...decrypted,
            id: cleanId,
            contentHtml: decrypted.contentHtml !== undefined ? decrypted.contentHtml : (decrypted.html || ''),
            html: decrypted.contentHtml !== undefined ? decrypted.contentHtml : (decrypted.html || '')
          };
          this.state.localCache.set(cleanId, fullNote);
          try { await VaultIDBStorage.putNote(fullNote); } catch (e) {}
          this._updateManifestCache(cleanId, fullNote);
          return fullNote;
        }
      } catch (e) {
        console.warn(`Failed to decrypt legacy note ${cleanId}`, e);
        return null;
      }
    }

    return null;
  },

  async getAllNotes() {
    if (!this.state.isUnlocked || !this.state.masterKey) return [];
    if (this.state.localCache.size === 0) {
      try {
        const idbNotes = await VaultIDBStorage.getAllNotes();
        for (const n of idbNotes) {
          if (n && n.id) this.state.localCache.set(n.id, n);
        }
      } catch (e) {}
    }

    const notes = [];
    for (const [id, docRecord] of this.state.localCache.entries()) {
      if (!docRecord) continue;
      if (docRecord.deleted || (docRecord.meta && docRecord.meta.deleted)) continue;

      if (docRecord.contentHtml !== undefined && !docRecord.meta?.ciphertext && !docRecord.ciphertext) {
        notes.push(docRecord);
        this._updateManifestCache(id, docRecord);
        continue;
      }

      const fullNote = await this.getNote(id);
      if (fullNote) {
        notes.push(fullNote);
      }
    }
    return notes;
  },

  // ── Generic & Itemized Documents (todos, planner, colleagues, chat, trash, snapshots, stash, settings) ──
  _normalizeDocKey(kind, id) {
    const k = String(kind || 'generic').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const i = String(id || 'default').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${k}__${i}`;
  },

  async putDocItem(kind, itemId, itemData, debounceMs = 5000) {
    return await this.putDoc(kind, itemId, itemData, debounceMs);
  },

  async deleteDocItem(kind, itemId, debounceMs = 5000) {
    return await this.deleteDoc(kind, itemId, debounceMs);
  },

  async getDocItem(kind, itemId) {
    return await this.getDoc(kind, itemId);
  },

  async getDocCollection(kind) {
    if (!this.state.isUnlocked || !this.state.masterKey) return [];
    const prefix = `${String(kind).trim().toLowerCase()}__`;
    const results = [];
    if (!this.state.docsCache) this.state.docsCache = new Map();

    for (const [key, val] of this.state.docsCache.entries()) {
      if (key.startsWith(prefix) && val !== null && val !== undefined) {
        results.push(val);
      }
    }

    try {
      const idbDocs = await VaultIDBStorage.getAllRecords('docs');
      for (const d of idbDocs) {
        if (d && d.id && d.id.startsWith(prefix) && !d.deleted) {
          if (!this.state.docsCache.has(d.id)) {
            if (d.data !== undefined) {
              this.state.docsCache.set(d.id, d.data);
              results.push(d.data);
            } else if (d.ciphertext) {
              try {
                const dec = await CryptoEngine.decryptData(this.state.masterKey, { iv: d.iv, ciphertext: d.ciphertext });
                if (dec) {
                  const val = dec.data !== undefined ? dec.data : dec;
                  this.state.docsCache.set(d.id, val);
                  results.push(val);
                }
              } catch (e) {}
            }
          }
        }
      }
    } catch (e) {}
    return results;
  },

  async putDoc(kind, id, docData, debounceMs = 5000) {
    if (this.state.status === this.STATUS.DECLINED) return false;
    if (!this.state.isUnlocked || !this.state.masterKey) return false;
    const docKey = this._normalizeDocKey(kind, id);
    const now = Date.now();

    // 1. Plaintext Local Document Record
    const docRecord = {
      id: docKey,
      kind,
      docId: id,
      data: docData,
      updatedAt: now,
      deleted: false,
      schemaVersion: this.SCHEMA_VERSION,
      appVersion: this.getCurrentVersion()
    };

    // 2. Cache in memory & IndexedDB
    if (!this.state.docsCache) this.state.docsCache = new Map();
    if (!this.state.pendingDocsQueue) this.state.pendingDocsQueue = new Map();
    this.state.docsCache.set(docKey, docData);
    this.state.pendingDocsQueue.set(docKey, docRecord);

    const walId = `wal_doc_${kind}_${id}_${now}`;
    try {
      await VaultIDBStorage.appendWAL({
        id: walId,
        type: 'doc_item',
        targetId: docKey,
        payload: {
          docKey,
          docRecord,
          data: docData
        },
        timestamp: now
      });
    } catch (e) {}

    SyncBroadcastBus.broadcast('DOC_UPDATED', {
      docKey,
      docRecord,
      data: docData
    });

    try {
      await VaultIDBStorage.putRecord('docs', docRecord);
    } catch (e) {
      console.warn(`Failed to persist doc ${docKey} in IndexedDB`, e);
    }

    // 3. Debounce Cloud Upload
    if (debounceMs <= 0) {
      await this.flushQueue();
    } else {
      if (this.state.syncTimer) clearTimeout(this.state.syncTimer);
      this.state.syncTimer = setTimeout(() => this.flushQueue(), debounceMs);
    }
    return true;
  },

  async getDoc(kind, id) {
    if (!this.state.isUnlocked || !this.state.masterKey) return null;
    const docKey = this._normalizeDocKey(kind, id);
    if (!this.state.docsCache) this.state.docsCache = new Map();
    if (this.state.docsCache.has(docKey)) {
      return this.state.docsCache.get(docKey);
    }

    let docRecord = null;
    try {
      docRecord = await VaultIDBStorage.getRecord('docs', docKey);
    } catch (e) {}

    if (!docRecord || docRecord.deleted) {
      return null;
    }

    if (docRecord.data !== undefined) {
      this.state.docsCache.set(docKey, docRecord.data);
      return docRecord.data;
    }

    if (docRecord.ciphertext) {
      try {
        const decrypted = await CryptoEngine.decryptData(this.state.masterKey, {
          iv: docRecord.iv,
          ciphertext: docRecord.ciphertext
        });
        if (decrypted) {
          const val = decrypted.data !== undefined ? decrypted.data : decrypted;
          this.state.docsCache.set(docKey, val);
          docRecord.data = val;
          delete docRecord.ciphertext;
          delete docRecord.iv;
          try { await VaultIDBStorage.putRecord('docs', docRecord); } catch (e) {}
          return val;
        }
      } catch (e) {
        console.warn(`Failed to decrypt doc ${docKey}`, e);
      }
    }
    return null;
  },

  async deleteDoc(kind, id, debounceMs = 5000) {
    if (!this.state.isUnlocked || !this.state.masterKey) return false;
    const docKey = this._normalizeDocKey(kind, id);

    if (!this.state.docsCache) this.state.docsCache = new Map();
    if (!this.state.pendingDocsQueue) this.state.pendingDocsQueue = new Map();
    this.state.docsCache.delete(docKey);
    const now = Date.now();
    const docRecord = {
      id: docKey,
      kind,
      docId: id,
      deleted: true,
      updatedAt: now,
      schemaVersion: this.SCHEMA_VERSION,
      appVersion: this.getCurrentVersion()
    };
    this.state.pendingDocsQueue.set(docKey, docRecord);

    const walId = `wal_deldoc_${kind}_${id}_${now}`;
    try {
      await VaultIDBStorage.appendWAL({
        id: walId,
        type: 'delete_doc_item',
        targetId: docKey,
        payload: {
          docKey,
          docRecord
        },
        timestamp: now
      });
    } catch (e) {}

    SyncBroadcastBus.broadcast('DOC_DELETED', { docKey });

    try {
      await VaultIDBStorage.putRecord('docs', docRecord);
    } catch (e) {
      console.warn(`Failed to update doc deletion ${docKey} in IndexedDB`, e);
    }

    if (debounceMs <= 0) {
      await this.flushQueue();
    } else {
      if (this.state.syncTimer) clearTimeout(this.state.syncTimer);
      this.state.syncTimer = setTimeout(() => this.flushQueue(), debounceMs);
    }
    return true;
  },

  async getAllDocs(kind) {
    if (!this.state.isUnlocked || !this.state.masterKey) return [];
    if (!this.state.docsCache) this.state.docsCache = new Map();
    const prefix = `${kind}__`;

    const docsMap = new Map();
    try {
      const records = typeof VaultIDBStorage.getRecordsByIndex === 'function'
        ? await VaultIDBStorage.getRecordsByIndex('docs', 'kind', kind)
        : await VaultIDBStorage.getAllRecords('docs');
      for (const r of records) {
        if (r && r.id && (r.kind === kind || r.id.startsWith(prefix))) {
          docsMap.set(r.id, r);
        }
      }
    } catch (e) {}

    const results = [];
    for (const [docKey, r] of docsMap.entries()) {
      if (!r || r.deleted) continue;
      if (this.state.docsCache.has(docKey)) {
        results.push({ id: r.docId || docKey.slice(prefix.length), data: this.state.docsCache.get(docKey) });
        continue;
      }
      if (r.data !== undefined) {
        this.state.docsCache.set(docKey, r.data);
        results.push({ id: r.docId || docKey.slice(prefix.length), data: r.data });
        continue;
      }
      if (r.ciphertext) {
        try {
          const decrypted = await CryptoEngine.decryptData(this.state.masterKey, {
            iv: r.iv,
            ciphertext: r.ciphertext
          });
          if (decrypted) {
            const val = decrypted.data !== undefined ? decrypted.data : decrypted;
            this.state.docsCache.set(docKey, val);
            results.push({ id: r.docId || docKey.slice(prefix.length), data: val });
          }
        } catch (e) {
          console.warn(`Failed to decrypt doc ${docKey}`, e);
        }
      }
    }
    return results;
  },

  async listDocs(kind) {
    return await this.getAllDocs(kind);
  },

  async repairManifestTitles() {
    if (!this.state.isUnlocked || !this.state.masterKey) return;
    const isDummy = (t, id) => !t || t === id || t === 'Untitled' || t === 'Untitled Note' || /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(t) || /^note[-_]/.test(t);
    let updatedAny = false;
    for (const [id, meta] of this.state.manifestCache.entries()) {
      if (isDummy(meta.title, id)) {
        try {
          const note = await this.getNote(id);
          const html = note ? (note.contentHtml || note.html || '') : '';
          if (html) {
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i) || html.match(/<h1[^>]*class=["'][^"']*title[^"']*["'][^>]*>([^<]+)<\/h1>/i) || html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
            if (titleMatch && titleMatch[1]?.trim() && !isDummy(titleMatch[1].trim(), id)) {
              meta.title = titleMatch[1].trim();
              meta.updatedAt = Date.now();
              this.state.manifestCache.set(id, meta);
              updatedAny = true;
              try {
                const docRecord = this.state.localCache.get(id);
                if (docRecord) {
                  docRecord.title = meta.title;
                  docRecord.updatedAt = meta.updatedAt;
                  await VaultIDBStorage.putRecord('notes', docRecord);
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }
    if (updatedAny) {
      try {
        await VaultIDBStorage.saveMeta('manifest_cache', Array.from(this.state.manifestCache.values()));
        if (typeof window !== 'undefined' && Array.isArray(window.manifest)) {
          const updatedList = this.getManifest();
          window.manifest = updatedList;
          if (typeof buildSearchIndex === 'function') {
            buildSearchIndex(updatedList);
          }
        }
      } catch (e) {}
    }
  },

  // ── Encrypted Assets (Images) ──
  async saveAsset(assetId, dataUrlOrBase64, meta = {}, debounceMs = 5000) {
    if (!assetId || !dataUrlOrBase64) return false;
    if (!this.state.isUnlocked || !this.state.masterKey) return false;

    const normalizedId = String(assetId).replace(/^[./\\]+/, '').replace(/^notes\//, '').replace(/^assets\//, '');
    const now = Date.now();
    const assetRecord = {
      id: normalizedId,
      data: String(dataUrlOrBase64),
      mimeType: meta.mimeType || 'image/webp',
      updatedAt: now,
      deleted: false,
      schemaVersion: this.SCHEMA_VERSION,
      appVersion: this.getCurrentVersion()
    };

    if (!this.state.assetsCache) this.state.assetsCache = new Map();
    if (!this.state.pendingAssetsQueue) this.state.pendingAssetsQueue = new Map();
    this.state.assetsCache.set(normalizedId, dataUrlOrBase64);
    this.state.pendingAssetsQueue.set(normalizedId, assetRecord);

    const walId = `wal_asset_${normalizedId}_${now}`;
    try {
      await VaultIDBStorage.appendWAL({
        id: walId,
        type: 'asset',
        targetId: normalizedId,
        payload: {
          normalizedId,
          assetRecord
        },
        timestamp: now
      });
    } catch (e) {}

    SyncBroadcastBus.broadcast('ASSET_UPDATED', { assetId: normalizedId });

    try {
      await VaultIDBStorage.putRecord('assets', assetRecord);
    } catch (e) {
      console.warn(`Failed to save asset ${normalizedId} to IndexedDB`, e);
    }

    if (debounceMs <= 0) {
      await this.flushQueue();
    } else {
      if (this.state.syncTimer) clearTimeout(this.state.syncTimer);
      this.state.syncTimer = setTimeout(() => this.flushQueue(), debounceMs);
    }
    return true;
  },

  async getAsset(assetId) {
    if (!assetId || !this.state.isUnlocked || !this.state.masterKey) return null;
    const normalizedId = String(assetId).replace(/^[./\\]+/, '').replace(/^notes\//, '').replace(/^assets\//, '');

    if (!this.state.assetsCache) this.state.assetsCache = new Map();
    if (this.state.assetsCache.has(normalizedId)) {
      return this.state.assetsCache.get(normalizedId);
    }

    let rec = null;
    try {
      rec = await VaultIDBStorage.getRecord('assets', normalizedId);
    } catch (e) {}

    if (!rec) {
      const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);
      if (bridge && this.state.userId && this.state.userId !== 'default_user' && typeof bridge.getAsset === 'function') {
        try {
          const remoteRec = await bridge.getAsset(this.state.userId, normalizedId);
          if (remoteRec && remoteRec.ciphertext) {
            const decData = await CryptoEngine.decryptData(this.state.masterKey, {
              iv: remoteRec.iv,
              ciphertext: remoteRec.ciphertext
            });
            if (decData) {
              rec = {
                id: normalizedId,
                data: decData,
                mimeType: remoteRec.mimeType || 'image/webp',
                updatedAt: remoteRec.updatedAt || Date.now(),
                deleted: false
              };
              await VaultIDBStorage.putRecord('assets', rec);
            }
          }
        } catch (e) {}
      }
    }

    if (!rec || rec.deleted) return null;

    if (rec.data !== undefined) {
      this.state.assetsCache.set(normalizedId, rec.data);
      return rec.data;
    }

    if (rec.ciphertext) {
      try {
        const decrypted = await CryptoEngine.decryptData(this.state.masterKey, {
          iv: rec.iv,
          ciphertext: rec.ciphertext
        });
        if (decrypted) {
          this.state.assetsCache.set(normalizedId, decrypted);
          rec.data = decrypted;
          delete rec.ciphertext;
          delete rec.iv;
          try { await VaultIDBStorage.putRecord('assets', rec); } catch (e) {}
          return decrypted;
        }
      } catch (e) {
        console.warn(`Failed to decrypt asset ${normalizedId}`, e);
      }
    }
    return null;
  },

  async deleteAsset(assetId, debounceMs = 5000) {
    if (!assetId || !this.state.isUnlocked || !this.state.masterKey) return false;
    const normalizedId = String(assetId).replace(/^[./\\]+/, '').replace(/^notes\//, '').replace(/^assets\//, '');

    if (!this.state.assetsCache) this.state.assetsCache = new Map();
    if (!this.state.pendingAssetsQueue) this.state.pendingAssetsQueue = new Map();
    this.state.assetsCache.delete(normalizedId);
    const now = Date.now();
    const assetRecord = {
      id: normalizedId,
      deleted: true,
      updatedAt: now,
      schemaVersion: this.SCHEMA_VERSION,
      appVersion: this.getCurrentVersion()
    };
    this.state.pendingAssetsQueue.set(normalizedId, assetRecord);

    const walId = `wal_delasset_${normalizedId}_${now}`;
    try {
      await VaultIDBStorage.appendWAL({
        id: walId,
        type: 'delete_asset',
        targetId: normalizedId,
        payload: {
          normalizedId,
          assetRecord
        },
        timestamp: now
      });
    } catch (e) {}

    SyncBroadcastBus.broadcast('ASSET_DELETED', { assetId: normalizedId });

    try {
      await VaultIDBStorage.putRecord('assets', assetRecord);
    } catch (e) {}

    if (debounceMs <= 0) {
      await this.flushQueue();
    } else {
      if (this.state.syncTimer) clearTimeout(this.state.syncTimer);
      this.state.syncTimer = setTimeout(() => this.flushQueue(), debounceMs);
    }
    return true;
  },

  async flushQueue() {
    if (this.state.syncTimer) clearTimeout(this.state.syncTimer);
    if (this.state.status === this.STATUS.DECLINED) {
      return;
    }
    if (this.state.pendingQueue.size === 0 && (!this.state.pendingDocsQueue || this.state.pendingDocsQueue.size === 0) && (!this.state.pendingAssetsQueue || this.state.pendingAssetsQueue.size === 0)) {
      this.state.status = this.STATUS.SYNCED;
      this._notifyStatus();
      return;
    }

    const isOnline = typeof navigator !== 'undefined' && navigator.onLine !== undefined ? navigator.onLine : true;
    if (!isOnline) {
      this.state.status = this.STATUS.OFFLINE;
      this._notifyStatus('Saved to local Firebase cache (offline)');
      return;
    }

    // Atomic snapshot of in-flight batch to prevent wiping concurrently queued edits
    const inFlightBatch = new Map(this.state.pendingQueue);
    const inFlightDocs = new Map(this.state.pendingDocsQueue || []);
    const inFlightAssets = new Map(this.state.pendingAssetsQueue || []);

    try {
      // Remove only items from pending queues whose updatedAt matches the in-flight snapshot
      for (const [id, flushedRecord] of inFlightBatch.entries()) {
        const current = this.state.pendingQueue.get(id);
        if (current && current.updatedAt === flushedRecord.updatedAt) {
          this.state.pendingQueue.delete(id);
        }
      }
      if (this.state.pendingDocsQueue) {
        for (const [id, flushedRecord] of inFlightDocs.entries()) {
          const current = this.state.pendingDocsQueue.get(id);
          if (current && current.updatedAt === flushedRecord.updatedAt) {
            this.state.pendingDocsQueue.delete(id);
          }
        }
      }
      if (this.state.pendingAssetsQueue) {
        for (const [id, flushedRecord] of inFlightAssets.entries()) {
          const current = this.state.pendingAssetsQueue.get(id);
          if (current && current.updatedAt === flushedRecord.updatedAt) {
            this.state.pendingAssetsQueue.delete(id);
          }
        }
      }

      // Persist latest manifest cache to IndexedDB
      try {
        await VaultIDBStorage.saveMeta('manifest_cache', Array.from(this.state.manifestCache.values()));
      } catch (e) {}

      // Clear flushed WAL entries
      try {
        await VaultIDBStorage.clearWAL();
      } catch (e) {}

      // Push flushed records to Firebase Realtime Database (Encrypt on the wire!)
      const bridge = typeof window !== 'undefined' ? window.FirebaseBridge : (typeof globalThis !== 'undefined' ? globalThis.FirebaseBridge : null);
      if (bridge && this.state.userId && this.state.userId !== 'default_user' && this.state.masterKey) {
        for (const [id, flushedRecord] of inFlightBatch.entries()) {
          try {
            if (flushedRecord.deleted || (flushedRecord.meta && flushedRecord.meta.deleted)) {
              await bridge.deleteNote(this.state.userId, id);
            } else {
              // 1. Prepare and encrypt meta on the fly for the wire
              const metaPayload = flushedRecord.metaPayload || {
                id: flushedRecord.id,
                path: flushedRecord.path || `notes/${flushedRecord.id}.html`,
                title: flushedRecord.title || 'Untitled',
                date: flushedRecord.date || '',
                tags: flushedRecord.tags || [],
                workstream: flushedRecord.workstream || '',
                pinned: !!flushedRecord.pinned,
                archived: !!flushedRecord.archived,
                favorite: !!flushedRecord.favorite,
                bodyHash: flushedRecord.bodyHash || this._hashContent(flushedRecord.contentHtml || flushedRecord.html || ''),
                updatedAt: flushedRecord.updatedAt || Date.now(),
                deleted: false,
                schemaVersion: this.SCHEMA_VERSION,
                appVersion: this.getCurrentVersion()
              };

              let encMeta = flushedRecord.meta;
              if (!encMeta || !encMeta.ciphertext) {
                const enc = await CryptoEngine.encryptData(this.state.masterKey, metaPayload);
                encMeta = {
                  id,
                  iv: enc.iv,
                  ciphertext: enc.ciphertext,
                  updatedAt: metaPayload.updatedAt,
                  deleted: false,
                  schemaVersion: this.SCHEMA_VERSION,
                  appVersion: this.getCurrentVersion()
                };
              }

              // 2. Prepare and encrypt body on the fly for the wire if body changed or present
              let encBody = flushedRecord.body;
              const contentHtml = flushedRecord.contentHtml !== undefined ? flushedRecord.contentHtml : (flushedRecord.html !== undefined ? flushedRecord.html : null);
              if (flushedRecord.bodyChanged !== false && contentHtml !== null && (!encBody || !encBody.ciphertext)) {
                const bodyPayload = {
                  id,
                  contentHtml,
                  updatedAt: metaPayload.updatedAt,
                  schemaVersion: this.SCHEMA_VERSION,
                  appVersion: this.getCurrentVersion()
                };
                const encB = await CryptoEngine.encryptData(this.state.masterKey, bodyPayload);
                encBody = {
                  id,
                  iv: encB.iv,
                  ciphertext: encB.ciphertext,
                  updatedAt: metaPayload.updatedAt,
                  schemaVersion: this.SCHEMA_VERSION,
                  appVersion: this.getCurrentVersion()
                };
              }

              if (typeof bridge.saveNoteMeta === 'function' && (encMeta || encBody)) {
                if (encMeta) {
                  await bridge.saveNoteMeta(this.state.userId, id, encMeta);
                }
                if (encBody && typeof bridge.saveNoteBody === 'function') {
                  await bridge.saveNoteBody(this.state.userId, id, encBody);
                }
              } else {
                const combinedWireRecord = {
                  id,
                  path: metaPayload.path,
                  iv: encMeta.iv,
                  ciphertext: encMeta.ciphertext,
                  meta: encMeta,
                  body: encBody || null,
                  updatedAt: metaPayload.updatedAt,
                  deleted: false,
                  schemaVersion: this.SCHEMA_VERSION,
                  appVersion: this.getCurrentVersion()
                };
                await bridge.saveNote(this.state.userId, id, combinedWireRecord);
              }
            }
          } catch (cloudErr) {
            console.warn(`[FirebaseSyncService] Cloud push error for note ${id}:`, cloudErr);
          }
        }

        for (const [id, flushedRecord] of inFlightDocs.entries()) {
          try {
            if (flushedRecord.deleted) {
              if (typeof bridge.deleteDoc === 'function') await bridge.deleteDoc(this.state.userId, id);
            } else {
              let encDoc = flushedRecord;
              if (!encDoc.ciphertext) {
                const payload = {
                  kind: flushedRecord.kind,
                  id: flushedRecord.docId,
                  docKey: flushedRecord.id,
                  data: flushedRecord.data,
                  updatedAt: flushedRecord.updatedAt || Date.now()
                };
                const enc = await CryptoEngine.encryptData(this.state.masterKey, payload);
                encDoc = {
                  id: flushedRecord.id,
                  kind: flushedRecord.kind,
                  docId: flushedRecord.docId,
                  iv: enc.iv,
                  ciphertext: enc.ciphertext,
                  updatedAt: payload.updatedAt,
                  deleted: false,
                  schemaVersion: this.SCHEMA_VERSION,
                  appVersion: this.getCurrentVersion()
                };
              }
              if (typeof bridge.saveDoc === 'function') await bridge.saveDoc(this.state.userId, id, encDoc);
            }
          } catch (cloudErr) {
            console.warn(`[FirebaseSyncService] Cloud push error for doc ${id}:`, cloudErr);
          }
        }

        for (const [id, flushedRecord] of inFlightAssets.entries()) {
          try {
            if (flushedRecord.deleted) {
              if (typeof bridge.deleteAsset === 'function') await bridge.deleteAsset(this.state.userId, id);
            } else {
              let encAsset = flushedRecord;
              if (!encAsset.ciphertext) {
                const enc = await CryptoEngine.encryptData(this.state.masterKey, String(flushedRecord.data));
                encAsset = {
                  id: flushedRecord.id,
                  iv: enc.iv,
                  ciphertext: enc.ciphertext,
                  mimeType: flushedRecord.mimeType || 'image/webp',
                  updatedAt: flushedRecord.updatedAt || Date.now(),
                  deleted: false,
                  schemaVersion: this.SCHEMA_VERSION,
                  appVersion: this.getCurrentVersion()
                };
              }
              if (typeof bridge.saveAsset === 'function') await bridge.saveAsset(this.state.userId, id, encAsset);
            }
          } catch (cloudErr) {
            console.warn(`[FirebaseSyncService] Cloud push error for asset ${id}:`, cloudErr);
          }
        }
      }

      this.state.lastSyncTimestamp = Date.now();
      this.state.status = this.STATUS.SYNCED;
      this.state.lastError = null;
      this._notifyStatus('Synced with cloud');
    } catch (err) {
      this.state.status = this.STATUS.ERROR;
      this.state.lastError = err.message;
      this._notifyStatus(err.message);
    }
  },

  async purgeLocalSessionAndQuit() {
    // 1. Flush any pending items to Firebase cloud
    try {
      if (this.state.pendingQueue.size > 0 || (this.state.pendingDocsQueue && this.state.pendingDocsQueue.size > 0) || (this.state.pendingAssetsQueue && this.state.pendingAssetsQueue.size > 0)) {
        await this.flushQueue();
      }
    } catch (e) {
      console.warn('Failed to flush queue before purge', e);
    }

    // 2. Clear all local IDB stores: notes, docs, assets, wal
    try {
      await VaultIDBStorage.clearStore('notes');
      await VaultIDBStorage.clearStore('docs');
      await VaultIDBStorage.clearStore('assets');
      await VaultIDBStorage.clearWAL();
      await VaultIDBStorage.deleteMeta('manifest_cache');
    } catch (e) {
      console.warn('Failed to clear IDB stores on purge', e);
    }

    // 3. Clear in-memory caches
    if (this.state.localCache) this.state.localCache.clear();
    if (this.state.manifestCache) this.state.manifestCache.clear();
    if (this.state.docsCache) this.state.docsCache.clear();
    if (this.state.encryptedDocs) this.state.encryptedDocs.clear();
    if (this.state.assetsCache) this.state.assetsCache.clear();
    if (this.state.encryptedAssets) this.state.encryptedAssets.clear();
    if (this.state.pendingQueue) this.state.pendingQueue.clear();
    if (this.state.pendingDocsQueue) this.state.pendingDocsQueue.clear();
    if (this.state.pendingAssetsQueue) this.state.pendingAssetsQueue.clear();

    // 4. Lock vault & clear master key
    this.lockVault();

    // 5. Clear saved session passphrase
    try {
      await this.clearSavedPassphrase();
    } catch (e) {}

    return true;
  },

  // ── Full Bidirectional Migration Assistent ──
  async migrateFromFilesystem(rawNotesList = [], passphrase, config = {}, additionalData = {}, onProgress = null) {
    if (!passphrase) throw new Error('Master passphrase is required for migration');

    // 1. Initialize E2EE Vault
    const { vaultMeta, key } = await this.setupVault(passphrase, config);
    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'vault',
        percent: 20,
        message: typeof t === 'function' ? t('sync.migrationProgressEncrypting') : 'Encrypting notes with AES-256-GCM…'
      });
    }

    // 2. Load notes in batches into local memory & IndexedDB in plaintext
    const BATCH_SIZE = 200;
    let batch = [];
    const totalNotes = rawNotesList.length;

    for (let i = 0; i < totalNotes; i++) {
      const note = rawNotesList[i];
      if (!note) continue;
      const rawId = note.id || note.path?.replace(/^notes\//, '').replace(/\.html$/, '') || ('note_' + Date.now());
      const cleanId = this._normalizeId(rawId);
      const contentHtml = note.contentHtml || note.html || '';
      const bodyHash = this._hashContent(contentHtml);
      const metaPayload = {
        id: cleanId,
        path: note.path || `notes/${cleanId}.html`,
        title: note.title || 'Untitled',
        date: note.date || new Date().toISOString().slice(0, 10),
        updatedAt: note.updatedAt || Date.now(),
        tags: Array.isArray(note.tags) ? note.tags : [],
        workstream: note.workstream || '',
        pinned: !!note.pinned,
        archived: !!note.archived,
        favorite: !!note.favorite,
        bodyHash,
        deleted: false,
        schemaVersion: this.SCHEMA_VERSION,
        appVersion: this.getCurrentVersion()
      };

      const docRecord = {
        ...metaPayload,
        contentHtml,
        html: contentHtml
      };

      this.state.localCache.set(cleanId, docRecord);
      this._updateManifestCache(cleanId, metaPayload);
      this.state.pendingQueue.set(cleanId, {
        id: cleanId,
        metaPayload,
        contentHtml,
        bodyChanged: true,
        updatedAt: metaPayload.updatedAt,
        deleted: false
      });
      batch.push(docRecord);

      if (batch.length >= BATCH_SIZE) {
        try {
          await VaultIDBStorage.putNotesBatch(batch);
        } catch (e) {
          console.warn('Failed to persist batch in IndexedDB', e);
        }
        batch = [];
        if (typeof onProgress === 'function') {
          const pct = 20 + Math.round(((i + 1) / Math.max(1, totalNotes)) * 50);
          onProgress({
            stage: 'notes',
            current: i + 1,
            total: totalNotes,
            percent: Math.min(70, pct),
            message: (typeof t === 'function' ? t('sync.migrationProgressEncrypting') : 'Migrating notes…') + ` (${i + 1}/${totalNotes})`
          });
        }
        // Yield to event loop during large batch migrations
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    if (batch.length > 0) {
      try {
        await VaultIDBStorage.putNotesBatch(batch);
      } catch (e) {
        console.warn('Failed to persist final batch in IndexedDB', e);
      }
    }

    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'stores',
        percent: 75,
        message: typeof t === 'function' ? t('sync.migrationProgressStores') : 'Storing planner, todos, colleagues and settings…'
      });
    }

    // 3. Migrate additional data (todos, planner, colleagues, trash, chat, stash, topicMemories, assets)
    const todosToSave = additionalData.todosManifest || (typeof window !== 'undefined' && Array.isArray(window.todosManifest) && window.todosManifest.length > 0 ? window.todosManifest : null);
    if (todosToSave) {
      await this.putDoc('todos', 'manifest', todosToSave);
    }
    if (additionalData.todosOrder) {
      await this.putDoc('todos', '_order', additionalData.todosOrder);
    }
    if (additionalData.planner) {
      await this.putDoc('planner', 'events', additionalData.planner);
    }
    if (additionalData.colleagues) {
      await this.putDoc('colleagues', 'database', additionalData.colleagues);
    }
    if (additionalData.colleaguesMigration) {
      await this.putDoc('colleagues', 'migration_v1_done', additionalData.colleaguesMigration);
    }
    if (additionalData.chatHistory) {
      await this.putDoc('chat', 'history', additionalData.chatHistory);
    }
    if (additionalData.trashManifest) {
      await this.putDoc('trash', 'manifest', additionalData.trashManifest);
    }
    if (Array.isArray(additionalData.trashNotes)) {
      for (const tNote of additionalData.trashNotes) {
        if (tNote && tNote.filename) {
          await this.putDoc('trash', tNote.filename, tNote);
        }
      }
    }
    if (Array.isArray(additionalData.stashFiles)) {
      for (const sFile of additionalData.stashFiles) {
        if (sFile && sFile.name) {
          await this.putDoc('stash', sFile.name, sFile);
        }
      }
    }
    if (additionalData.topicMemories) {
      if (additionalData.topicMemories.index) {
        await this.putDoc('topic_memories', 'index', additionalData.topicMemories.index);
      }
      if (Array.isArray(additionalData.topicMemories.memories)) {
        for (const tm of additionalData.topicMemories.memories) {
          if (tm && tm.key && tm.data) {
            await this.putDoc('topic_memories', tm.key, tm.data);
          }
        }
      }
    }
    if (Array.isArray(additionalData.assets)) {
      for (const a of additionalData.assets) {
        if (a && a.id && a.data) {
          await this.saveAsset(a.id, a.data, a.meta || {});
        }
      }
    }
    if (additionalData.settings && typeof additionalData.settings === 'object') {
      const sanitized = JSON.parse(JSON.stringify(additionalData.settings));
      delete sanitized.apiKey;
      delete sanitized.llmApiKey;
      delete sanitized.rememberPassphrase;
      delete sanitized.windowState;
      if (sanitized.ai && typeof sanitized.ai === 'object') {
        delete sanitized.ai.apiKey;
      }
      await this.putDoc('settings', 'config', sanitized);
    }

    // Persist manifest cache to IndexedDB
    try {
      await VaultIDBStorage.saveMeta('manifest_cache', Array.from(this.state.manifestCache.values()));
    } catch (e) {}

    // Flush any queued changes to cloud Realtime Database / Storage
    try {
      await this.flushQueue();
    } catch (e) {
      console.warn('Initial cloud flush after migration deferred:', e);
    }

    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'stores_done',
        percent: 80,
        message: typeof t === 'function' ? t('sync.migrationProgressArchiving') : 'Archiving local files to backup folder…'
      });
    }

    // 4. Switch engine mode to 'firebase'
    this.state.engine = 'firebase';
    this.state.lastSyncTimestamp = Date.now();
    this.state.status = this.STATUS.SYNCED;
    this._notifyStatus('Migrated to Firebase');

    return {
      vaultMeta,
      notesCount: this.state.localCache.size
    };
  },

  async reconcileNotes(notesList = [], onProgress = null) {
    if (!this.state.isUnlocked || !this.state.masterKey) {
      throw new Error('Vault is locked. Cannot reconcile notes.');
    }
    const total = notesList.length;
    const batch = [];

    for (let i = 0; i < total; i++) {
      const note = notesList[i];
      if (!note) continue;
      const rawId = note.id || note.path?.replace(/^notes\//, '').replace(/\.html$/, '') || ('note_' + Date.now());
      const cleanId = this._normalizeId(rawId);
      const contentHtml = note.contentHtml || note.html || '';
      const bodyHash = this._hashContent(contentHtml);
      const now = note.updatedAt || Date.now();
      const isDummy = (t, id) => !t || t === id || t === 'Untitled' || t === 'Untitled Note' || /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(t) || /^note[-_]/.test(t);
      let resolvedTitle = note.title || 'Untitled';
      if (isDummy(resolvedTitle, cleanId) && contentHtml) {
        const titleMatch = contentHtml.match(/<title[^>]*>([^<]+)<\/title>/i) || contentHtml.match(/<h1[^>]*class=["'][^"']*title[^"']*["'][^>]*>([^<]+)<\/h1>/i) || contentHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        if (titleMatch && titleMatch[1]?.trim() && !isDummy(titleMatch[1].trim(), cleanId)) {
          resolvedTitle = titleMatch[1].trim();
        }
      }

      const metaPayload = {
        id: cleanId,
        path: note.path || `notes/${cleanId}.html`,
        title: resolvedTitle,
        date: note.date || new Date().toISOString().slice(0, 10),
        updatedAt: now,
        tags: Array.isArray(note.tags) ? note.tags : [],
        workstream: note.workstream || '',
        pinned: !!note.pinned,
        archived: !!note.archived,
        favorite: !!note.favorite,
        bodyHash,
        deleted: false,
        schemaVersion: this.SCHEMA_VERSION,
        appVersion: this.getCurrentVersion()
      };

      const docRecord = {
        ...metaPayload,
        contentHtml,
        html: contentHtml
      };

      this.state.localCache.set(cleanId, docRecord);
      this._updateManifestCache(cleanId, metaPayload);
      this.state.pendingQueue.set(cleanId, {
        id: cleanId,
        metaPayload,
        contentHtml,
        bodyChanged: true,
        updatedAt: now,
        deleted: false
      });
      batch.push(docRecord);

      if (typeof onProgress === 'function') {
        onProgress({
          stage: 'reconciling',
          current: i + 1,
          total,
          percent: Math.round(((i + 1) / Math.max(1, total)) * 100),
          message: `Reconciling note ${i + 1}/${total}`
        });
      }
    }

    if (batch.length > 0) {
      await VaultIDBStorage.putNotesBatch(batch);
      try {
        await VaultIDBStorage.saveMeta('manifest_cache', Array.from(this.state.manifestCache.values()));
      } catch (e) {}
    }

    try {
      await this.flushQueue();
    } catch (e) {
      console.warn('Flush after reconcile deferred:', e);
    }

    return { reconciledCount: batch.length };
  },

  async fillGaps(notesList = [], onProgress = null) {
    return await this.reconcileNotes(notesList, onProgress);
  },

  async exportToFilesystem() {
    const allNotes = await this.getAllNotes();
    const manifestEntries = allNotes.map(n => ({
      id: n.id,
      path: n.path || `notes/${n.id}.html`,
      title: n.title || 'Untitled',
      date: n.date || '',
      updatedAt: n.updatedAt || Date.now(),
      tags: n.tags || [],
      workstream: n.workstream || '',
      pinned: !!n.pinned,
      archived: !!n.archived,
      favorite: !!n.favorite
    }));

    // Fetch all extra docs
    const todosManifest = await this.getDoc('todos', 'manifest');
    const todosOrder = await this.getDoc('todos', '_order');
    const planner = await this.getDoc('planner', 'events');
    const colleagues = await this.getDoc('colleagues', 'database');
    const colleaguesMigration = await this.getDoc('colleagues', 'migration_v1_done');
    const chatHistory = await this.getDoc('chat', 'history');
    const trashManifest = await this.getDoc('trash', 'manifest');
    const trashDocs = await this.getAllDocs('trash');
    const stashDocs = await this.getAllDocs('stash');
    const topicMemoriesIndex = await this.getDoc('topic_memories', 'index');
    const topicDocs = await this.getAllDocs('topic_memories');
    const topicMemoriesList = (topicDocs || []).filter(d => d.id !== 'index').map(d => ({ key: d.id, data: d }));
    const historyDocs = await this.getAllDocs('history');
    const settings = await this.getDoc('settings', 'config');

    // Fetch all assets
    const assetsMap = new Map(this.state.encryptedAssets || []);
    try {
      const allAssetRecords = await VaultIDBStorage.getAllRecords('assets');
      for (const ar of allAssetRecords) {
        if (ar && ar.id && !assetsMap.has(ar.id)) {
          assetsMap.set(ar.id, ar);
        }
      }
    } catch (e) {}

    const decryptedAssets = [];
    for (const [id, ar] of assetsMap.entries()) {
      if (ar && !ar.deleted) {
        const val = await this.getAsset(id);
        if (val) decryptedAssets.push({ id, data: val, mimeType: ar.mimeType });
      }
    }

    // Clear stores in IndexedDB
    try {
      await VaultIDBStorage.clearNotes();
      await VaultIDBStorage.clearStore('docs');
      await VaultIDBStorage.clearStore('assets');
      await VaultIDBStorage.saveMeta('vault_meta', null);
      await VaultIDBStorage.saveMeta('manifest_cache', null);
    } catch (e) {
      console.warn('Failed to clear IndexedDB on exportToFilesystem', e);
    }
    if (this.state.manifestCache) {
      this.state.manifestCache.clear();
    }
    if (this.state.encryptedDocs) {
      this.state.encryptedDocs.clear();
    }
    if (this.state.docsCache) {
      this.state.docsCache.clear();
    }
    if (this.state.encryptedAssets) {
      this.state.encryptedAssets.clear();
    }
    if (this.state.assetsCache) {
      this.state.assetsCache.clear();
    }
    try {
      await this.clearSavedPassphrase();
    } catch (e) {}
    if (typeof settings !== 'undefined' && settings) {
      delete settings.vaultMeta;
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
    }

    // Switch engine mode back to 'filesystem'
    this.state.engine = 'filesystem';
    this.state.status = this.STATUS.DISCONNECTED;
    this._notifyStatus('Reverted to Filesystem mode');

    return {
      manifest: manifestEntries,
      notes: allNotes,
      manifestCount: manifestEntries.length,
      notesCount: allNotes.length,
      todosManifest,
      todosOrder,
      planner,
      colleagues,
      colleaguesMigration,
      chatHistory,
      trashManifest,
      trashNotes: trashDocs.filter(d => d.id !== 'manifest').map(d => d.data),
      stashFiles: stashDocs.map(d => d.data),
      topicMemories: {
        index: topicMemoriesIndex,
        memories: topicMemoriesList
      },
      assets: decryptedAssets,
      settings
    };
  },

  // ── Sync Conflict Management & History Archival ──
  async detectConflict(cleanId, remoteNote) {
    if (!cleanId || !remoteNote) return null;
    const normalizedId = this._normalizeId(cleanId);
    const localDoc = this.state.localCache.get(normalizedId);
    const hasPending = this.state.pendingQueue.has(normalizedId);

    if (!localDoc || localDoc.deleted) {
      return null;
    }

    const localNote = await this.getNote(normalizedId);
    if (!localNote) return null;

    const localContent = String(localNote.contentHtml || localNote.html || '').trim();
    const remoteContent = String(remoteNote.contentHtml || remoteNote.html || '').trim();

    // If contents are strictly identical, no conflict exists
    if (localContent === remoteContent) {
      return null;
    }

    // A conflict ONLY exists if this local device has pending uncommitted/unflushed edits
    // that clash with divergent remote edits.
    // If local has NO pending edits, this is a clean fast-forward remote update.
    if (hasPending) {
      const conflict = {
        id: normalizedId,
        path: localNote.path || `notes/${normalizedId}.html`,
        localNote,
        remoteNote,
        detectedAt: Date.now()
      };
      this.state.conflicts.set(normalizedId, conflict);
      this._notifyStatus(`Conflict detected on note ${normalizedId}`);
      if (typeof window !== 'undefined' && window.ConflictResolverController) {
        window.ConflictResolverController.onConflictDetected(conflict);
      }
      return conflict;
    }

    return null;
  },

  hasConflict(noteId) {
    if (!this.state.conflicts) return false;
    return this.state.conflicts.has(this._normalizeId(noteId));
  },

  getConflict(noteId) {
    if (!this.state.conflicts) return null;
    return this.state.conflicts.get(this._normalizeId(noteId)) || null;
  },

  listConflicts() {
    if (!this.state.conflicts) return [];
    return Array.from(this.state.conflicts.values());
  },

  async resolveConflict(noteId, resolutionChoice) {
    const cleanId = this._normalizeId(noteId);
    if (resolutionChoice === 'keepA') resolutionChoice = 'keep_local';
    if (resolutionChoice === 'keepB') resolutionChoice = 'keep_remote';
    if (resolutionChoice === 'keepBoth') resolutionChoice = 'keep_both';
    const conflict = this.getConflict(cleanId);
    if (!conflict) {
      return { resolved: false, error: 'Conflict not found' };
    }

    const notePath = conflict.localNote.path || conflict.remoteNote.path || `notes/${cleanId}.html`;

    if (resolutionChoice === 'keep_local') {
      // 1. Archive the declined remote version in Note History (.history/)
      if (typeof window !== 'undefined' && window.StorageAPI?.saveSnapshot) {
        try {
          await window.StorageAPI.saveSnapshot(
            notePath,
            conflict.remoteNote.contentHtml || conflict.remoteNote.html || '',
            'conflict-declined-remote'
          );
        } catch (e) {
          console.warn('Failed to archive declined remote snapshot', e);
        }
      }

      // 2. Commit local note to Firebase cache and queue sync
      await this.queueSyncNote(conflict.localNote, 0);
      this.state.conflicts.delete(cleanId);
      this._notifyStatus(`Conflict resolved: kept local note ${cleanId}`);

      return {
        resolved: true,
        choice: 'keep_local',
        note: conflict.localNote,
        archivedVersion: 'remote'
      };
    }

    if (resolutionChoice === 'keep_remote') {
      // 1. Archive the declined local version in Note History (.history/)
      if (typeof window !== 'undefined' && window.StorageAPI?.saveSnapshot) {
        try {
          await window.StorageAPI.saveSnapshot(
            notePath,
            conflict.localNote.contentHtml || conflict.localNote.html || '',
            'conflict-declined-local'
          );
        } catch (e) {
          console.warn('Failed to archive declined local snapshot', e);
        }
      }

      // 2. Remove pending local edit from queue so it won't overwrite remote
      this.state.pendingQueue.delete(cleanId);

      // 3. Write remote note content to storage / local vault
      if (typeof window !== 'undefined' && window.StorageAPI?.writeNoteContent) {
        await window.StorageAPI.writeNoteContent(
          notePath,
          conflict.remoteNote.contentHtml || conflict.remoteNote.html || '',
          conflict.remoteNote
        );
      } else {
        await this.queueSyncNote(conflict.remoteNote, 0);
      }

      this.state.conflicts.delete(cleanId);
      this._notifyStatus(`Conflict resolved: accepted remote note ${cleanId}`);

      return {
        resolved: true,
        choice: 'keep_remote',
        note: conflict.remoteNote,
        archivedVersion: 'local'
      };
    }

    if (resolutionChoice === 'keep_both') {
      // 1. Local note remains the active note at notePath
      await this.queueSyncNote(conflict.localNote, 0);

      // 2. Create a separate duplicate note for the remote version
      const timestamp = Date.now();
      const copyId = `${cleanId}-conflict-${timestamp}`;
      const copyPath = `notes/${copyId}.html`;
      const copyTitle = `${conflict.remoteNote.title || 'Note'} (Conflict Copy)`;
      const copyNote = {
        ...conflict.remoteNote,
        id: copyId,
        path: copyPath,
        title: copyTitle,
        updatedAt: timestamp
      };

      if (typeof window !== 'undefined' && window.StorageAPI?.writeNoteContent) {
        await window.StorageAPI.writeNoteContent(copyPath, copyNote.contentHtml || copyNote.html || '', copyNote);
      } else {
        await this.queueSyncNote(copyNote, 0);
      }

      this.state.conflicts.delete(cleanId);
      this._notifyStatus(`Conflict resolved: kept both as separate notes`);

      return {
        resolved: true,
        choice: 'keep_both',
        note: conflict.localNote,
        copyNote
      };
    }

    return { resolved: false, error: `Invalid resolution choice: ${resolutionChoice}` };
  }
};

if (typeof window !== 'undefined') {
  window.VaultIDBStorage = VaultIDBStorage;
  window.FirebaseSyncService = FirebaseSyncService;
}
FirebaseSyncService.idb = VaultIDBStorage;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FirebaseSyncService, VaultIDBStorage };
}

