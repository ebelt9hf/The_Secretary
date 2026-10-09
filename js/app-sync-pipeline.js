'use strict';

/**
 * Secretary: Background Sync & Thread Pipeline Controller (js/app-sync-pipeline.js)
 *
 * Coordinates the multi-threaded synchronization pipeline between:
 * - Tier 1: Local IndexedDB (operational store via VaultIDBStorage)
 * - Tier 3: Cloud Vault (Firebase) or Local Disk Backup
 *
 * Runs all heavy operations (PBKDF2 key derivation, AES-256-GCM encryption/decryption,
 * and remote network uploads) off the main UI thread via Web Worker (js/app-sync-worker.js).
 *
 * Features:
 * - Web Worker thread lifecycle management with request-response multiplexing
 * - Streamed background events (remote sync changes, progress notifications)
 * - Transparent fallback to in-process SyncWorkerEngine in environments without Web Workers
 * - Storage Event Bus integration
 */
const SyncPipeline = {
  _worker: null,
  _pendingRequests: new Map(),
  _eventListeners: new Map(),
  _isInitialized: false,
  _mode: 'uninitialized', // 'worker' | 'direct' | 'uninitialized'
  _status: 'idle', // 'idle' | 'syncing' | 'locked' | 'unlocked' | 'error'

  /**
   * Initialize the sync pipeline and start the background worker thread
   * @param {Object} [config] - Optional Firebase or vault configuration
   */
  async init(config = null) {
    if (this._isInitialized && this._worker) {
      return await this._send('INIT', { config });
    }

    this._mode = 'direct';
    this._status = 'idle';

    // Check if standard Web Worker is supported in current environment
    const hasWorkerSupport = typeof window !== 'undefined' && typeof window.Worker === 'function';

    if (hasWorkerSupport) {
      try {
        // Resolve script path with optional cache busting
        const scriptUrl = 'js/app-sync-worker.js';
        this._worker = new window.Worker(scriptUrl);

        this._worker.onmessage = (event) => {
          this._handleWorkerMessage(event.data);
        };

        this._worker.onerror = (error) => {
          console.warn('[SyncPipeline] Worker encountered an error:', error);
          this._emit('pipeline:error', { error: error?.message || 'Worker thread error' });
        };

        this._mode = 'worker';
      } catch (err) {
        console.warn('[SyncPipeline] Failed to spawn Web Worker, falling back to direct mode:', err);
        this._worker = null;
        this._mode = 'direct';
      }
    }

    this._isInitialized = true;
    this._emit('pipeline:status', { status: this._status, mode: this._mode });

    const result = await this._send('INIT', { config });
    return result;
  },

  /**
   * Check whether the pipeline is running on a true background worker thread
   */
  isWorkerMode() {
    return this._mode === 'worker' && this._worker !== null;
  },

  /**
   * Get current pipeline status
   */
  getStatus() {
    return this._status;
  },

  // ── Vault Lifecycle Actions ──

  async setupVault(passphrase) {
    this._status = 'syncing';
    this._emit('pipeline:status', { status: this._status, mode: this._mode });
    try {
      const res = await this._send('SETUP_VAULT', { passphrase });
      this._status = 'unlocked';
      this._emit('pipeline:status', { status: this._status, mode: this._mode });
      return res;
    } catch (err) {
      this._status = 'error';
      this._emit('pipeline:status', { status: this._status, error: err.message });
      throw err;
    }
  },

  async unlockVault(passphrase, vaultMeta = null) {
    this._status = 'syncing';
    this._emit('pipeline:status', { status: this._status, mode: this._mode });
    try {
      const res = await this._send('UNLOCK_VAULT', { passphrase, vaultMeta });
      if (res && res.verified) {
        this._status = 'unlocked';
      } else {
        this._status = 'locked';
      }
      this._emit('pipeline:status', { status: this._status, mode: this._mode });
      return res;
    } catch (err) {
      this._status = 'error';
      this._emit('pipeline:status', { status: this._status, error: err.message });
      throw err;
    }
  },

  async lockVault() {
    const res = await this._send('LOCK_VAULT');
    this._status = 'locked';
    this._emit('pipeline:status', { status: this._status, mode: this._mode });
    return res;
  },

  async rotatePassphrase(oldPassphrase, newPassphrase) {
    this._status = 'syncing';
    this._emit('pipeline:status', { status: this._status, mode: this._mode });
    try {
      const res = await this._send('ROTATE_PASSPHRASE', { oldPassphrase, newPassphrase });
      this._status = 'unlocked';
      this._emit('pipeline:status', { status: this._status, mode: this._mode });
      return res;
    } catch (err) {
      this._status = 'error';
      this._emit('pipeline:status', { status: this._status, error: err.message });
      throw err;
    }
  },

  // ── Notes Pipeline Operations ──

  async saveNote(id, noteData, revId = null, chunkType = 'full') {
    const res = await this._send('SAVE_NOTE', { id, noteData }, revId, chunkType);
    this._emit('pipeline:noteSaved', { id, revId, chunkType });
    if (typeof StorageAPI !== 'undefined' && StorageAPI.emit) {
      StorageAPI.emit('storage:change', { entity: 'notes', id, action: 'save' });
    }
    return res;
  },

  async getNote(id) {
    return await this._send('GET_NOTE', { id });
  },

  async deleteNote(id) {
    const res = await this._send('DELETE_NOTE', { id });
    this._emit('pipeline:noteDeleted', { id });
    if (typeof StorageAPI !== 'undefined' && StorageAPI.emit) {
      StorageAPI.emit('storage:change', { entity: 'notes', id, action: 'delete' });
    }
    return res;
  },

  async listNotes() {
    return await this._send('LIST_NOTES');
  },

  // ── Generic Docs Pipeline Operations ──

  async saveDoc(kind, id, docData, revId = null) {
    const res = await this._send('SAVE_DOC', { kind, id, docData }, revId);
    this._emit('pipeline:docSaved', { kind, id, revId });
    if (typeof StorageAPI !== 'undefined' && StorageAPI.emit) {
      StorageAPI.emit('storage:change', { entity: 'docs', kind, id, action: 'save' });
    }
    return res;
  },

  async getDoc(kind, id) {
    return await this._send('GET_DOC', { kind, id });
  },

  async deleteDoc(kind, id) {
    const res = await this._send('DELETE_DOC', { kind, id });
    this._emit('pipeline:docDeleted', { kind, id });
    if (typeof StorageAPI !== 'undefined' && StorageAPI.emit) {
      StorageAPI.emit('storage:change', { entity: 'docs', kind, id, action: 'delete' });
    }
    return res;
  },

  async listDocs(kind) {
    return await this._send('LIST_DOCS', { kind });
  },

  // ── Assets Pipeline Operations ──

  async saveAsset(pathOrId, content) {
    const res = await this._send('SAVE_ASSET', { pathOrId, content });
    this._emit('pipeline:assetSaved', { pathOrId });
    if (typeof StorageAPI !== 'undefined' && StorageAPI.emit) {
      StorageAPI.emit('storage:change', { entity: 'assets', id: pathOrId, action: 'save' });
    }
    return res;
  },

  async getAsset(pathOrId) {
    return await this._send('GET_ASSET', { pathOrId });
  },

  // ── Event Bus ──

  on(event, handler) {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set());
    }
    this._eventListeners.get(event).add(handler);
    return () => this.off(event, handler);
  },

  off(event, handler) {
    if (!this._eventListeners.has(event)) return;
    this._eventListeners.get(event).delete(handler);
  },

  _emit(event, data = {}) {
    if (this._eventListeners.has(event)) {
      for (const handler of this._eventListeners.get(event)) {
        try { handler(data); } catch (e) { console.warn(`[SyncPipeline] Listener error (${event}):`, e); }
      }
    }
  },

  // ── Message Multiplexing & Communication ──

  _send(action, payload = {}, revId = null, chunkType = 'full') {
    return new Promise((resolve, reject) => {
      const id = 'req_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
      const message = { id, action, payload, revId, chunkType };

      // Set request timeout (30 seconds)
      const timer = setTimeout(() => {
        if (this._pendingRequests.has(id)) {
          this._pendingRequests.delete(id);
          reject(new Error(`[SyncPipeline] Request ${action} timed out after 30s`));
        }
      }, 30000);

      this._pendingRequests.set(id, { resolve, reject, timer });

      if (this._mode === 'worker' && this._worker) {
        this._worker.postMessage(message);
      } else {
        // Fallback to direct SyncWorkerEngine handling
        this._dispatchDirect(message);
      }
    });
  },

  async _dispatchDirect(message) {
    const engine = (typeof SyncWorkerEngine !== 'undefined' ? SyncWorkerEngine : null)
      || (typeof window !== 'undefined' && window.SyncWorkerEngine ? window.SyncWorkerEngine : null)
      || (typeof globalThis !== 'undefined' && globalThis.SyncWorkerEngine ? globalThis.SyncWorkerEngine : null);

    const handler = (typeof handleWorkerMessage === 'function' ? handleWorkerMessage : null)
      || (typeof window !== 'undefined' && typeof window.handleWorkerMessage === 'function' ? window.handleWorkerMessage : null)
      || (typeof globalThis !== 'undefined' && typeof globalThis.handleWorkerMessage === 'function' ? globalThis.handleWorkerMessage : null);

    if (engine && typeof engine.setResponseHandler === 'function') {
      engine.setResponseHandler((msg) => {
        this._handleWorkerMessage(msg);
      });
    }

    if (handler) {
      try {
        await handler({ data: message });
      } catch (err) {
        this._handleWorkerMessage({ id: message.id, success: false, error: { message: err.message } });
      }
    } else {
      this._handleWorkerMessage({
        id: message.id,
        success: false,
        error: { message: 'SyncWorkerEngine handler is not available' }
      });
    }
  },

  _handleWorkerMessage(msg) {
    if (!msg) return;

    // Handle streamed events from worker
    if (msg.isEvent) {
      this._emit(msg.event, msg.data);
      if (msg.event === 'EVENT_REMOTE_NOTE' && msg.data) {
        this._emit('pipeline:remoteNote', msg.data);
        if (typeof StorageAPI !== 'undefined' && StorageAPI.emit) {
          StorageAPI.emit('storage:change', { entity: 'notes', id: msg.data.id, action: 'remote_update' });
        }
      } else if (msg.event === 'EVENT_ROTATION_PROGRESS' && msg.data) {
        this._emit('pipeline:rotationProgress', msg.data);
      }
      return;
    }

    // Handle request response
    const pending = this._pendingRequests.get(msg.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this._pendingRequests.delete(msg.id);

    if (msg.success) {
      pending.resolve(msg.data);
    } else {
      const err = new Error(msg.error?.message || 'SyncWorker operation failed');
      if (msg.error?.stack) err.stack = msg.error.stack;
      pending.reject(err);
    }
  },

  /**
   * Terminate background worker and cleanup active requests
   */
  destroy() {
    if (this._worker) {
      try { this._worker.terminate(); } catch (e) {}
      this._worker = null;
    }
    for (const [, req] of this._pendingRequests) {
      clearTimeout(req.timer);
      req.reject(new Error('[SyncPipeline] Destroyed'));
    }
    this._pendingRequests.clear();
    this._eventListeners.clear();
    this._isInitialized = false;
    this._mode = 'uninitialized';
    this._status = 'idle';
  }
};

if (typeof window !== 'undefined') {
  window.SyncPipeline = SyncPipeline;
}
if (typeof globalThis !== 'undefined') {
  globalThis.SyncPipeline = SyncPipeline;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SyncPipeline;
}
