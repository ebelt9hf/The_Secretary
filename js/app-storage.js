'use strict';

/**
 * Secretary: Data Abstraction Layer (Storage API)
 *
 * Implements a clean, semantic abstraction layer between the application logic and 
 * the underlying storage engine (currently filesystem-based using app-fs.js).
 * 
 * To move the application to a database (e.g. IndexedDB, SQLite, or a remote server database),
 * only this file needs to be updated.
 */
const StorageAPI = {
  _storageEngine: 'filesystem',

  getStorageEngine() {
    if (typeof window !== 'undefined' && window.FirebaseSyncService?.state?.engine) {
      return window.FirebaseSyncService.state.engine;
    }
    return this._storageEngine;
  },

  setStorageEngine(engine) {
    this._storageEngine = engine === 'firebase' ? 'firebase' : 'filesystem';
    if (typeof window !== 'undefined' && window.FirebaseSyncService) {
      if (!window.FirebaseSyncService.state) window.FirebaseSyncService.state = {};
      window.FirebaseSyncService.state.engine = this._storageEngine;
    }
  },

  // ── Connector Status & Error Classification ──
  _connectorStatus: {
    status: 'synced', // 'synced' | 'syncing' | 'error' | 'offline'
    error: null,      // null | { type: 'permission'|'auth'|'quota'|'network'|'disk', message: string, engine: string, raw: Error }
    lastSyncTime: Date.now()
  },

  getConnectorStatus() {
    const engine = this.getStorageEngine();
    if (engine === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.getStatus) {
      const fbStatus = window.FirebaseSyncService.getStatus();
      if (this._connectorStatus.status === 'error' && this._connectorStatus.error?.engine === 'firebase') {
        return { ...fbStatus, status: 'error', error: this._connectorStatus.error };
      }
      return fbStatus;
    }
    return {
      engine: 'filesystem',
      status: this._connectorStatus.status,
      error: this._connectorStatus.error,
      lastSyncTime: this._connectorStatus.lastSyncTime
    };
  },

  setConnectorStatus(status, error = null) {
    this._connectorStatus.status = status;
    this._connectorStatus.error = error;
    if (status === 'synced') {
      this._connectorStatus.lastSyncTime = Date.now();
    }
    if (typeof window !== 'undefined' && typeof window.updateCloudSyncUI === 'function') {
      window.updateCloudSyncUI(this.getConnectorStatus());
    }
  },

  classifyConnectorError(err) {
    if (!err) return { type: 'disk', message: 'Unknown error', engine: this.getStorageEngine() };
    const name = String(err.name || '').toLowerCase();
    const msg = String(err.message || err || '');
    const lower = msg.toLowerCase();
    const engine = this.getStorageEngine();

    // 1. Disk Permission Issues (File System Access API permission denied/revoked/expired)
    if (name === 'notallowederror' || name === 'securityerror' || lower.includes('permission') || lower.includes('not allowed') || lower.includes('denied') || lower.includes('user activation') || lower.includes('re-select')) {
      return { type: 'permission', message: msg || 'Folder access permission denied or expired', engine, raw: err };
    }

    // 2. Authentication / Vault Issues (Firebase auth, token expired, vault locked)
    if (name === 'autherror' || lower.includes('auth') || lower.includes('unauthorized') || lower.includes('token') || lower.includes('passphrase') || lower.includes('vault is locked') || lower.includes('permission-denied')) {
      return { type: 'auth', message: msg || 'Authentication expired or vault locked', engine, raw: err };
    }

    // 3. Quota / Storage Full Issues
    if (name === 'quotaexceedederror' || lower.includes('quota') || lower.includes('enospc') || lower.includes('full') || lower.includes('disk full') || lower.includes('out of space')) {
      return { type: 'quota', message: msg || 'Storage quota exceeded or disk is full', engine, raw: err };
    }

    // 4. Network Issues
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (isOffline || name === 'networkerror' || lower.includes('network') || lower.includes('offline') || lower.includes('failed to fetch') || lower.includes('econnrefused') || lower.includes('enotfound')) {
      return { type: 'network', message: msg || 'Network connection unavailable', engine, raw: err };
    }

    // 5. General disk/filesystem write error
    return { type: 'disk', message: msg || 'Storage write failed', engine, raw: err };
  },

  notifyCriticalLocalFailure(err, entity, id) {
    console.error(`[StorageAPI] CRITICAL: Tier 1 Local Storage (RAM/IndexedDB) failed for ${entity}:${id}!`, err);
    if (typeof window !== 'undefined') {
      const msg = typeof t === 'function'
        ? t('sync.criticalLocalStorageError')
        : 'CRITICAL STORAGE ERROR: Browser local storage (IndexedDB) failed. Your changes cannot be preserved locally and will be lost!';
      if (typeof window.toast === 'function') {
        window.toast(msg, 12000, 'error');
      } else if (typeof alert === 'function') {
        alert(msg);
      }
    }
  },

  notifyConnectorError(errorInfo) {
    if (!errorInfo) return;
    const type = errorInfo.type || 'disk';
    let userMsg = '';
    if (type === 'permission') {
      userMsg = typeof t === 'function' ? t('sync.errorPermissionDenied') : 'Disk Permission Issue: Folder access was denied or expired. Click the sync icon to re-grant permission.';
    } else if (type === 'auth') {
      userMsg = typeof t === 'function' ? t('sync.errorAuthExpired') : 'Authentication Issue: Cloud session expired or vault is locked. Click the sync icon to authenticate.';
    } else if (type === 'quota') {
      userMsg = typeof t === 'function' ? t('sync.errorQuotaExceeded') : 'Storage Quota Exceeded: Your disk or cloud storage is full.';
    } else if (type === 'network') {
      userMsg = typeof t === 'function' ? t('sync.errorNetworkOffline') : 'Network Offline: Changes are safely stored locally in IndexedDB and will sync when online.';
    } else {
      userMsg = typeof t === 'function' ? t('sync.errorConnectorGeneric') : 'Storage Connector Error: Failed to write changes to storage connector. Changes remain safe in local IndexedDB.';
    }

    if (typeof window !== 'undefined' && typeof window.toast === 'function') {
      window.toast(userMsg, 8000, type === 'network' ? 'info' : 'error');
    }
  },

  // ── Tier 1 (RAM & IndexedDB) Persistence ──
  async _persistNoteTier1(cleanId, path, content, meta = {}) {
    // 1. RAM Cache (0ms)
    this._noteCache.set(path, content);
    if (cleanId) this._noteCache.set(`notes/${cleanId}.html`, content);

    // 2. IndexedDB Persistent Store
    const idb = (typeof VaultIDBStorage !== 'undefined' ? VaultIDBStorage : null) || (typeof window !== 'undefined' ? window.VaultIDBStorage : null);
    if (idb && typeof idb.putNote === 'function') {
      try {
        await idb.putNote(cleanId, {
          id: cleanId,
          path,
          content,
          title: meta.title || '',
          date: meta.date || '',
          tags: meta.tags || [],
          workstream: meta.workstream || '',
          pinned: !!meta.pinned,
          archived: !!meta.archived,
          favorite: !!meta.favorite,
          updatedAt: Date.now()
        });
      } catch (idbErr) {
        this.notifyCriticalLocalFailure(idbErr, 'note', cleanId);
        throw idbErr;
      }
    }
  },

  async _persistAssetTier1(relPath, fullDataUrl) {
    if (typeof fullDataUrl === 'string' && fullDataUrl.includes('data:image/svg+xml') && (fullDataUrl.includes('Image not loaded') || fullDataUrl.includes('locked'))) {
      return;
    }
    const clean = String(relPath).replace(/^[./\\]+/, '').replace(/^notes\//, '').replace(/^(_assets|assets)\//, '');
    const fileName = clean.split('/').pop() || clean;

    // 1. RAM Cache
    const ramCache = (typeof _assetDataUrlCache !== 'undefined' ? _assetDataUrlCache : null) || (typeof window !== 'undefined' ? window._assetDataUrlCache : null);
    if (ramCache && typeof ramCache.set === 'function') {
      ramCache.set(relPath, fullDataUrl);
      ramCache.set(fileName, fullDataUrl);
      ramCache.set(`notes/_assets/${fileName}`, fullDataUrl);
      ramCache.set(`_assets/${fileName}`, fullDataUrl);
    }

    // 2. IndexedDB Persistent Store
    const idb = (typeof VaultIDBStorage !== 'undefined' ? VaultIDBStorage : null) || (typeof window !== 'undefined' ? window.VaultIDBStorage : null);
    if (idb && typeof idb.putRecord === 'function') {
      try {
        await idb.putRecord('assets', {
          id: fileName,
          data: String(fullDataUrl),
          updatedAt: Date.now()
        });
        await idb.putRecord('assets', {
          id: `notes/_assets/${fileName}`,
          data: String(fullDataUrl),
          updatedAt: Date.now()
        });
      } catch (idbErr) {
        this.notifyCriticalLocalFailure(idbErr, 'asset', fileName);
        throw idbErr;
      }
    }
  },

  async _persistDocTier1(kind, id, payload) {
    const idb = (typeof VaultIDBStorage !== 'undefined' ? VaultIDBStorage : null) || (typeof window !== 'undefined' ? window.VaultIDBStorage : null);
    if (idb && typeof idb.putRecord === 'function') {
      try {
        await idb.putRecord('docs', {
          id: `${kind}:${id}`,
          kind,
          docId: id,
          data: payload,
          updatedAt: Date.now()
        });
      } catch (idbErr) {
        this.notifyCriticalLocalFailure(idbErr, kind, id);
        throw idbErr;
      }
    }
  },

  // ── Generic JSON Storage Helpers ──
  async _readJSON(filePath, fallback = null) {
    try {
      const raw = await readFile(filePath);
      if (typeof raw !== 'string') return fallback;
      if (raw.length > 10 * 1024 * 1024) {
        console.warn(`StorageAPI._readJSON(${filePath}) exceeded 10MB safety limit, returning fallback`);
        return fallback;
      }
      return JSON.parse(raw);
    } catch (e) {
      if (e && e.name !== 'NotFoundError' && !e.message?.includes('No root folder handle loaded')) {
        console.warn(`StorageAPI._readJSON(${filePath}) failed, returning fallback`, e);
      }
      return fallback;
    }
  },

  async _writeJSON(filePath, payload) {
    await writeFile(filePath, JSON.stringify(payload, null, 2));
  },

  // ── Notes Manifest ──
  async readNotesManifest() {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const manifestList = window.FirebaseSyncService.getManifest();
      if (manifestList && (manifestList.length > 0 || (window.FirebaseSyncService.state.localCache && window.FirebaseSyncService.state.localCache.size === 0))) {
        return manifestList;
      }
      const firebaseNotes = await window.FirebaseSyncService.getAllNotes();
      return (firebaseNotes || []).map(n => ({
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
    }
    return await this._readJSON('notes/manifest.json', []);
  },

  async writeNotesManifest(manifest) {
    if (this.getStorageEngine() !== 'firebase') {
      try {
        await this._writeJSON('notes/manifest.json', manifest);
      } catch (e) {
        throw e;
      }
    }

    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked && Array.isArray(manifest)) {
      if (!this._lastManifestMap) this._lastManifestMap = new Map();
      for (const item of manifest) {
        if (!item) continue;
        const noteId = item.id || (item.path ? item.path.replace(/^notes\//, '').replace(/\.html$/, '') : null);
        if (!noteId) continue;

        // Delta check: skip notes whose metadata has not changed to avoid O(N) crypto freeze
        const metaHash = `${item.title || ''}|${(item.tags || []).join(',')}|${item.workstream || ''}|${!!item.pinned}|${!!item.archived}|${!!item.favorite}|${item.date || ''}`;
        if (this._lastManifestMap.get(noteId) === metaHash) {
          continue;
        }
        this._lastManifestMap.set(noteId, metaHash);

        if (typeof window.FirebaseSyncService._updateManifestCache === 'function') {
          window.FirebaseSyncService._updateManifestCache(noteId, item);
        }

        if (typeof window.FirebaseSyncService.updateNoteMetadata === 'function') {
          // Update local encrypted cache immediately and debounce cloud network flush
          await window.FirebaseSyncService.updateNoteMetadata(noteId, {
            title: item.title,
            tags: item.tags,
            workstream: item.workstream,
            pinned: item.pinned,
            archived: item.archived,
            favorite: item.favorite,
            date: item.date
          }, 5000);
        }
      }
    }
  },

  async writeNotesManifestJS(jsContent) {
    if (this.getStorageEngine() !== 'firebase') {
      try {
        await writeFile('notes/manifest.js', jsContent);
      } catch (e) {
        console.warn('Failed to write notes/manifest.js', e);
      }
    }
  },

  // ── Generic Document Entity Helpers ──
  async readDocEntity(docKind, docId, localFile, fallback = null) {
    // 1. Check IndexedDB Persistent Layer (fast local)
    const idb = (typeof VaultIDBStorage !== 'undefined' ? VaultIDBStorage : null) || (typeof window !== 'undefined' ? window.VaultIDBStorage : null);
    let idbResult = null;
    if (idb && typeof idb.getRecord === 'function') {
      try {
        const found = await idb.getRecord('docs', `${docKind}:${docId}`) || await idb.getRecord('docs', docId);
        if (found && found.data !== undefined) {
          idbResult = found.data;
        }
      } catch (e) {}
    }

    // 2. Check active connector
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const doc = await window.FirebaseSyncService.getDoc(docKind, docId);
      if (doc !== null && doc !== undefined) {
        if (idb && typeof idb.putRecord === 'function') {
          idb.putRecord('docs', { id: `${docKind}:${docId}`, kind: docKind, docId, data: doc, updatedAt: Date.now() }).catch(() => {});
        }
        return doc;
      }
      return idbResult !== null ? idbResult : fallback;
    }

    const localRes = await this._readJSON(localFile, null);
    if (localRes !== null && localRes !== undefined) {
      if (idb && typeof idb.putRecord === 'function') {
        idb.putRecord('docs', { id: `${docKind}:${docId}`, kind: docKind, docId, data: localRes, updatedAt: Date.now() }).catch(() => {});
      }
      return localRes;
    }

    return idbResult !== null ? idbResult : fallback;
  },

  async writeDocEntity(docKind, docId, localFile, payload) {
    // 1. Write to Tier 1 (IndexedDB) immediately
    await this._persistDocTier1(docKind, docId, payload);

    // 2. Dispatch to Asynchronous Connector
    try {
      this.setConnectorStatus('syncing');

      if (this.getStorageEngine() !== 'firebase') {
        try {
          await this._writeJSON(localFile, payload);
        } catch (localErr) {
          console.warn('StorageAPI writeDocEntity local filesystem write warning:', localFile, localErr);
        }
      } else if (typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
        await window.FirebaseSyncService.putDoc(docKind, docId, payload);
      }

      this.setConnectorStatus('synced');
    } catch (e) {
      const errorInfo = this.classifyConnectorError(e);
      this.setConnectorStatus('error', errorInfo);
      this.notifyConnectorError(errorInfo);
      throw e;
    }

    this.emit('storage:change', { entity: 'docs', kind: docKind, id: docId, action: 'save' });
  },

  async hasDocEntity(docKind, docId, localFile) {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const doc = await window.FirebaseSyncService.getDoc(docKind, docId);
      return doc !== null && doc !== undefined;
    }
    return await fileExists(localFile);
  },

  // ── Todos Manifest ──
  async readTodosManifest() {
    const todos = await this.readDocEntity('todos', 'manifest', 'todos/manifest.json', []);
    return Array.isArray(todos) ? todos : [];
  },

  async writeTodosManifest(todosManifest) {
    await this.writeDocEntity('todos', 'manifest', 'todos/manifest.json', todosManifest);
  },

  async hasTodosManifest() {
    return await this.hasDocEntity('todos', 'manifest', 'todos/manifest.json');
  },

  // ── Planner Events ──
  async readPlanner() {
    return await this.readDocEntity('planner', 'events', 'planner.json', null);
  },

  async writePlanner(plannerData) {
    await this.writeDocEntity('planner', 'events', 'planner.json', plannerData);
  },

  async hasPlanner() {
    return await this.hasDocEntity('planner', 'events', 'planner.json');
  },

  // ── Planner Proposals (External Agent Proposed Events & Subscribed Feeds) ──
  async readPlannerProposals() {
    // 1. Check local file on disk first so external agents running on computer are detected immediately
    try {
      const local = await this._readJSON('planner-proposals.json', null);
      if (local && typeof local === 'object') {
        await this._persistDocTier1('planner', 'proposals', local).catch(() => {});
        return local;
      }
    } catch {}

    // 2. Route through 2-tier async doc entity (Firebase vault or Tier 1 IndexedDB)
    return await this.readDocEntity('planner', 'proposals', 'planner-proposals.json', null);
  },

  async writePlannerProposals(proposalsData) {
    // 1. Persist to Tier 1 IndexedDB immediately
    await this._persistDocTier1('planner', 'proposals', proposalsData);

    // 2. Always write to local planner-proposals.json on disk if available (for external agents & scripts)
    try {
      await this._writeJSON('planner-proposals.json', proposalsData);
    } catch (e) {
      // Expected in pure web mode when no local folder handle is loaded
    }

    // 3. If in Firebase mode, sync to encrypted cloud vault
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      try {
        await window.FirebaseSyncService.putDoc('planner', 'proposals', proposalsData);
      } catch (e) {
        console.warn('Firebase putDoc for proposals failed:', e);
      }
    }

    this.emit('storage:change', { entity: 'docs', kind: 'planner', id: 'proposals', action: 'save' });
  },

  async hasPlannerProposals() {
    return await this.hasDocEntity('planner', 'proposals', 'planner-proposals.json');
  },

  // ── Colleagues ──
  async readColleagues() {
    return await this.readDocEntity('colleagues', 'database', 'colleagues.json', null);
  },

  async writeColleagues(colleaguesDb) {
    await this.writeDocEntity('colleagues', 'database', 'colleagues.json', colleaguesDb);
  },

  async hasColleagues() {
    return await this.hasDocEntity('colleagues', 'database', 'colleagues.json');
  },

  async readColleaguesMigration() {
    return await this.readDocEntity('colleagues', 'migration_v1_done', '.secretary/colleagues-migration-v1.done', null);
  },

  async writeColleaguesMigration(data) {
    await this.writeDocEntity('colleagues', 'migration_v1_done', '.secretary/colleagues-migration-v1.done', data);
  },

  async hasColleaguesMigration() {
    return await this.hasDocEntity('colleagues', 'migration_v1_done', '.secretary/colleagues-migration-v1.done');
  },

  // ── Settings ──
  _sanitizeSettingsForCloud(settings) {
    if (!settings || typeof settings !== 'object') return {};
    const cloned = JSON.parse(JSON.stringify(settings));
    delete cloned.apiKey;
    delete cloned.llmApiKey;
    delete cloned.rememberPassphrase;
    delete cloned.windowState;
    if (cloned.ai && typeof cloned.ai === 'object') {
      delete cloned.ai.apiKey;
    }
    return cloned;
  },

  async _hydrateSecureSecrets(settings) {
    if (!settings || typeof settings !== 'object') return;
    if (typeof window !== 'undefined' && window.electronAPI?.secureSecrets?.isAvailable) {
      try {
        const isAvail = await window.electronAPI.secureSecrets.isAvailable();
        if (isAvail) {
          const storedKey = await window.electronAPI.secureSecrets.get('ai.apiKey');
          if (storedKey) {
            settings.ai = settings.ai || {};
            settings.ai.apiKey = storedKey;
          }
        }
      } catch (e) {
        console.warn('Could not hydrate secrets from OS keychain:', e);
      }
    }
  },

  async readSettings(path) {
    const local = (await this._readJSON(path || 'secretary-settings.json', null)) || {};
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      try {
        const cloudSettings = await window.FirebaseSyncService.getDoc('settings', 'config');
        if (cloudSettings && typeof cloudSettings === 'object') {
          const localAi = (local && local.ai) || {};
          const cloudAi = (cloudSettings && cloudSettings.ai) || {};
          const merged = {
            ...local,
            ...cloudSettings,
            ui: { ...(local.ui || {}), ...(cloudSettings.ui || {}) },
            ai: {
              ...cloudAi,
              ...localAi // Preserves local API keys and endpoints
            }
          };
          await this._hydrateSecureSecrets(merged);
          return merged;
        }
      } catch (e) {
        console.warn('Failed reading cloud settings:', e);
      }
    }
    if (local && Object.keys(local).length > 0) {
      await this._hydrateSecureSecrets(local);
      return local;
    }
    return null;
  },

  async writeSettings(settings) {
    let settingsToWrite = settings;
    if (typeof window !== 'undefined' && window.electronAPI?.secureSecrets?.isAvailable) {
      try {
        const isAvail = await window.electronAPI.secureSecrets.isAvailable();
        if (isAvail) {
          const aiKey = settings.ai?.apiKey;
          if (aiKey && aiKey !== '[SECURED_IN_OS_KEYCHAIN]') {
            await window.electronAPI.secureSecrets.save('ai.apiKey', aiKey);
          } else if (aiKey === '') {
            await window.electronAPI.secureSecrets.clear('ai.apiKey');
          }
          const cloned = JSON.parse(JSON.stringify(settings));
          if (cloned.ai) {
            cloned.ai.apiKey = aiKey ? '[SECURED_IN_OS_KEYCHAIN]' : '';
          }
          settingsToWrite = cloned;
        }
      } catch (e) {
        console.warn('Could not securely store secret key via OS keychain:', e);
      }
    }

    await this._writeJSON('secretary-settings.json', settingsToWrite);
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      // Sync non-credential settings to encrypted cloud vault
      const sanitized = this._sanitizeSettingsForCloud(settings);
      await window.FirebaseSyncService.putDoc('settings', 'config', sanitized);
    }
  },

  async hasSettings(path) {
    return await fileExists(path);
  },

  // ── Note / Todo Content (HTML or MD) & Cache ──
  _noteCache: new Map(),

  clearNoteCache() {
    this._noteCache.clear();
  },

  invalidateNoteCache(path) {
    if (path) {
      this._noteCache.delete(path);
    } else {
      this._noteCache.clear();
    }
  },

  getNoteFromCache(path) {
    if (!path) return null;
    return this._noteCache.get(path) || null;
  },

  async preloadAllNotes(onProgress = null) {
    const list = (typeof manifest !== 'undefined' && Array.isArray(manifest)) ? manifest : [];
    const total = list.length;
    if (total === 0) {
      if (typeof onProgress === 'function') onProgress(0, 0, '');
      return;
    }

    const CONCURRENCY = 12;
    let completed = 0;

    for (let i = 0; i < total; i += CONCURRENCY) {
      const chunk = list.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(async (item) => {
        if (!item || !item.path) return;
        try {
          if (!this._noteCache.has(item.path)) {
            const html = await this.readNoteContent(item.path);
            this._noteCache.set(item.path, html);
          }
        } catch (e) {
          // File might not exist or error
        } finally {
          completed++;
          if (typeof onProgress === 'function') {
            onProgress(completed, total, item.title || item.path);
          }
        }
      }));
    }
  },

  async readNoteContent(path) {
    if (!path) return '';

    // 1. Check RAM Cache (0ms)
    if (this._noteCache.has(path)) {
      return this._noteCache.get(path);
    }

    const cleanId = path.replace(/^notes\//, '').replace(/\.html$/, '');

    // 2. Check IndexedDB Persistent Layer (fast local)
    const idb = (typeof VaultIDBStorage !== 'undefined' ? VaultIDBStorage : null) || (typeof window !== 'undefined' ? window.VaultIDBStorage : null);
    if (idb && typeof idb.getNote === 'function') {
      try {
        const rec = await idb.getNote(cleanId) || await idb.getNote(path);
        if (rec && rec.content) {
          this._noteCache.set(path, rec.content);
          return rec.content;
        }
      } catch (e) {}
    }

    // 3. Check Connector
    if (this.getStorageEngine() === 'firebase') {
      if (typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
        const noteId = window.FirebaseSyncService._normalizeId
          ? window.FirebaseSyncService._normalizeId(path)
          : cleanId;
        const firebaseNote = await window.FirebaseSyncService.getNote(noteId);
        if (firebaseNote) {
          const content = firebaseNote.contentHtml || firebaseNote.html || '';
          this._noteCache.set(path, content);
          if (idb && typeof idb.putNote === 'function') {
            idb.putNote(cleanId, { id: cleanId, path, content, ...firebaseNote }).catch(() => {});
          }
          return content;
        }
      }
      try {
        const content = await readFile(path);
        if (content && typeof content === 'string') {
          this._noteCache.set(path, content);
          if (idb && typeof idb.putNote === 'function') {
            idb.putNote(cleanId, { id: cleanId, path, content }).catch(() => {});
          }
          return content;
        }
      } catch (e) {}
      return '';
    }

    // Local filesystem connector
    try {
      const content = await readFile(path);
      if (content && typeof content === 'string') {
        this._noteCache.set(path, content);
        if (idb && typeof idb.putNote === 'function') {
          idb.putNote(cleanId, { id: cleanId, path, content }).catch(() => {});
        }
        return content;
      }
    } catch (e) {
      if (e?.name === 'NotAllowedError') {
        const errInfo = this.classifyConnectorError(e);
        this.setConnectorStatus('error', errInfo);
        this.notifyConnectorError(errInfo);
      }
    }

    const err = new Error(`File not found: ${path}`);
    err.name = 'NotFoundError';
    throw err;
  },

  async writeNoteContent(path, content, meta = {}) {
    const cleanId = meta.id || path.replace(/^notes\//, '').replace(/\.html$/, '');

    // 1. Write to Tier 1 (RAM & IndexedDB) immediately
    await this._persistNoteTier1(cleanId, path, content, meta);

    // 2. Dispatch to Asynchronous Connector
    try {
      this.setConnectorStatus('syncing');

      if (this.getStorageEngine() !== 'firebase') {
        await writeFile(path, content);
      } else if (typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
        const isDummy = (t, id) => !t || t === id || t === 'Untitled' || t === 'Untitled Note' || /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(t) || /^note[-_]/.test(t);
        let resolvedTitle = meta.title;
        if (isDummy(resolvedTitle, cleanId) && content && typeof parseNoteHTML === 'function') {
          try {
            const parsed = parseNoteHTML(content);
            if (parsed.title && !isDummy(parsed.title, cleanId)) {
              resolvedTitle = parsed.title;
            }
          } catch (e) {}
        }
        await window.FirebaseSyncService.queueSyncNote({
          id: cleanId,
          path,
          contentHtml: content,
          title: resolvedTitle || meta.title || cleanId,
          date: meta.date,
          tags: meta.tags,
          workstream: meta.workstream,
          pinned: meta.pinned,
          archived: meta.archived,
          favorite: meta.favorite,
          updatedAt: Date.now()
        });
      }

      this.setConnectorStatus('synced');
    } catch (e) {
      const errorInfo = this.classifyConnectorError(e);
      this.setConnectorStatus('error', errorInfo);
      this.notifyConnectorError(errorInfo);
      throw e;
    }

    this.emit('storage:change', { entity: 'notes', id: cleanId, path, action: 'save' });
  },

  async deleteNoteContent(path) {
    if (this.getStorageEngine() !== 'firebase') {
      try {
        await deleteFile(path);
      } catch (e) {
        throw e;
      }
    }

    if (path) {
      this._noteCache.delete(path);
    }

    if (typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const noteId = path.replace(/^notes\//, '').replace(/\.html$/, '');
      await window.FirebaseSyncService.deleteNote(noteId);
    }
  },

  // ── Trash Bin (.trash/) ──
  async listTrash() {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const list = await window.FirebaseSyncService.getDoc('trash', 'manifest');
      return Array.isArray(list) ? list : [];
    }
    return await this._readJSON('.trash/manifest.json', []);
  },

  async moveToTrash(path, meta = {}) {
    if (!path) return null;
    const content = await this.readNoteContent(path);
    const filename = path.split('/').pop() || 'note.html';
    
    const trashList = await this.listTrash();
    let trashFilename = filename;
    let counter = 1;
    while (trashList.some(item => item.filename === trashFilename)) {
      counter++;
      const dotIdx = filename.lastIndexOf('.');
      if (dotIdx !== -1) {
        trashFilename = `${filename.slice(0, dotIdx)}_${counter}${filename.slice(dotIdx)}`;
      } else {
        trashFilename = `${filename}_${counter}`;
      }
    }

    const trashEntry = {
      filename: trashFilename,
      originalPath: path,
      title: meta.title || filename.replace(/\.html$/i, ''),
      deletedAt: new Date().toISOString()
    };
    trashList.unshift(trashEntry);

    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      await window.FirebaseSyncService.putDoc('trash', 'manifest', trashList);
      await window.FirebaseSyncService.putDoc('trash', trashFilename, {
        ...trashEntry,
        content
      });
    } else {
      const trashPath = `.trash/${trashFilename}`;
      await writeFile(trashPath, content);
      await this._writeJSON('.trash/manifest.json', trashList);
    }

    await this.deleteNoteContent(path);
    return trashEntry;
  },

  async restoreFromTrash(trashFilename) {
    const trashList = await this.listTrash();
    const idx = trashList.findIndex(item => item.filename === trashFilename);
    if (idx === -1) {
      throw new Error(`Note not found in trash: ${trashFilename}`);
    }
    const entry = trashList[idx];
    let content = '';

    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const trashDoc = await window.FirebaseSyncService.getDoc('trash', trashFilename);
      content = trashDoc?.content || '';
    } else {
      const trashPath = `.trash/${trashFilename}`;
      content = await readFile(trashPath);
    }

    let destinationPath = entry.originalPath || `notes/${trashFilename}`;
    if (await this.hasNoteContent(destinationPath)) {
      const parts = destinationPath.split('/');
      const destFilename = parts.pop();
      const destDir = parts.join('/');
      const dotIdx = destFilename.lastIndexOf('.');
      const base = dotIdx !== -1 ? destFilename.slice(0, dotIdx) : destFilename;
      const ext = dotIdx !== -1 ? destFilename.slice(dotIdx) : '';
      destinationPath = await uniqueFilePath(destDir, base, ext);
    }

    await this.writeNoteContent(destinationPath, content, { title: entry.title });

    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      await window.FirebaseSyncService.deleteDoc('trash', trashFilename);
      trashList.splice(idx, 1);
      await window.FirebaseSyncService.putDoc('trash', 'manifest', trashList);
    } else {
      const trashPath = `.trash/${trashFilename}`;
      await deleteFile(trashPath);
      trashList.splice(idx, 1);
      await this._writeJSON('.trash/manifest.json', trashList);
    }

    return { path: destinationPath, content, title: entry.title };
  },

  async permanentDeleteFromTrash(trashFilename) {
    const trashList = await this.listTrash();
    const idx = trashList.findIndex(item => item.filename === trashFilename);
    if (idx !== -1) {
      trashList.splice(idx, 1);
    }

    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      await window.FirebaseSyncService.deleteDoc('trash', trashFilename);
      await window.FirebaseSyncService.putDoc('trash', 'manifest', trashList);
    } else {
      if (idx !== -1) {
        await this._writeJSON('.trash/manifest.json', trashList);
      }
      await deleteFile(`.trash/${trashFilename}`);
    }
    return true;
  },

  async emptyTrash() {
    const trashList = await this.listTrash();
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      for (const item of trashList) {
        try {
          await window.FirebaseSyncService.deleteDoc('trash', item.filename);
        } catch (e) {}
      }
      await window.FirebaseSyncService.putDoc('trash', 'manifest', []);
    } else {
      for (const item of trashList) {
        try {
          await deleteFile(`.trash/${item.filename}`);
        } catch (e) {
          console.warn(`Failed to delete .trash/${item.filename}`, e);
        }
      }
      await this._writeJSON('.trash/manifest.json', []);
    }
    return true;
  },

  // ── Note Version History & Snapshots (.history/) ──
  _getHistoryKey(notePath) {
    const raw = String(notePath || '').split('/').pop() || 'note';
    return raw.replace(/[^a-zA-Z0-9._-]/g, '_');
  },

  async listSnapshots(notePath) {
    const key = this._getHistoryKey(notePath);
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const manifest = await window.FirebaseSyncService.getDoc('history', `${key}_manifest`);
      return Array.isArray(manifest) ? manifest : [];
    }
    const manifest = await this._readJSON(`.history/${key}/manifest.json`, []);
    return Array.isArray(manifest) ? manifest : [];
  },

  async saveSnapshot(notePath, content, reason = 'manual') {
    if (!notePath || content === undefined || content === null) return null;
    const key = this._getHistoryKey(notePath);
    const manifest = await this.listSnapshots(notePath);

    const snapshotId = 'rev-' + Date.now();
    const meta = {
      id: snapshotId,
      timestamp: Date.now(),
      dateStr: new Date().toISOString(),
      reason: reason || 'manual',
      size: content.length
    };

    manifest.unshift(meta);

    // Keep up to 20 revisions
    if (manifest.length > 20) {
      const removed = manifest.splice(20);
      if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
        for (const old of removed) {
          try { await window.FirebaseSyncService.deleteDoc('history', `${key}_${old.id}`); } catch (e) {}
        }
      } else {
        for (const old of removed) {
          try { await deleteFile(`.history/${key}/${old.id}.html`); } catch (e) {}
        }
      }
    }

    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      await window.FirebaseSyncService.putDoc('history', `${key}_${snapshotId}`, { id: snapshotId, content, meta });
      await window.FirebaseSyncService.putDoc('history', `${key}_manifest`, manifest);
    } else {
      const filePath = `.history/${key}/${snapshotId}.html`;
      await writeFile(filePath, String(content));
      await this._writeJSON(`.history/${key}/manifest.json`, manifest);
    }

    return meta;
  },

  async getSnapshotContent(notePath, snapshotId) {
    const key = this._getHistoryKey(notePath);
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const doc = await window.FirebaseSyncService.getDoc('history', `${key}_${snapshotId}`);
      return doc?.content !== undefined ? doc.content : null;
    }
    const filePath = `.history/${key}/${snapshotId}.html`;
    try {
      return await readFile(filePath);
    } catch (err) {
      return null;
    }
  },

  async restoreSnapshot(notePath, snapshotId) {
    const content = await this.getSnapshotContent(notePath, snapshotId);
    if (content === null || content === undefined) {
      throw new Error('Snapshot not found');
    }

    // Auto-save pre-rollback snapshot of current note
    try {
      const current = await this.readNoteContent(notePath);
      if (current) {
        await this.saveSnapshot(notePath, current, 'pre-rollback');
      }
    } catch (e) {}

    await this.writeNoteContent(notePath, content);
    return content;
  },

  async hasNoteContent(path) {
    if (!path) return false;
    if (this._noteCache.has(path)) return true;
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const noteId = window.FirebaseSyncService._normalizeId
        ? window.FirebaseSyncService._normalizeId(path)
        : path.replace(/^notes\//, '').replace(/\.html$/, '');
      if (typeof window.FirebaseSyncService.hasNote === 'function') {
        return await window.FirebaseSyncService.hasNote(noteId);
      }
      const n = await window.FirebaseSyncService.getNote(noteId);
      return !!n;
    }
    return await fileExists(path);
  },

  // ── Todos Index ──
  async writeTodosIndex(html) {
    if (this.getStorageEngine() !== 'firebase') {
      await writeFile('todos/index.html', html);
    }
  },

  // ── Metadata Buffer & Sharding ──
  async readMetadataBuffer() {
    if (this.getStorageEngine() === 'firebase') return null;
    return await this._readJSON('notes/metadata-buffer.json', null);
  },

  async writeMetadataBuffer(payload) {
    if (this.getStorageEngine() !== 'firebase') {
      await this._writeJSON('notes/metadata-buffer.json', payload);
    }
  },

  async hasMetadataBuffer() {
    if (this.getStorageEngine() === 'firebase') return false;
    return await fileExists('notes/metadata-buffer.json');
  },

  async readMetadataShardsIndex() {
    if (this.getStorageEngine() === 'firebase') return null;
    return await this._readJSON('notes/metadata-shards/index.json', null);
  },

  async writeMetadataShardsIndex(payload) {
    if (this.getStorageEngine() !== 'firebase') {
      await this._writeJSON('notes/metadata-shards/index.json', payload);
    }
  },

  async hasMetadataShardsIndex() {
    if (this.getStorageEngine() === 'firebase') return false;
    return await fileExists('notes/metadata-shards/index.json');
  },

  async deleteMetadataShardsIndex() {
    if (this.getStorageEngine() !== 'firebase') {
      await deleteFile('notes/metadata-shards/index.json');
    }
  },

  async readMetadataShard(shardFile) {
    if (this.getStorageEngine() === 'firebase') return null;
    return await this._readJSON(`notes/metadata-shards/${shardFile}`, null);
  },

  async writeMetadataShard(shardFile, payload) {
    if (this.getStorageEngine() !== 'firebase') {
      await this._writeJSON(`notes/metadata-shards/${shardFile}`, payload);
    }
  },

  async deleteMetadataShard(shardFile) {
    if (this.getStorageEngine() !== 'firebase') {
      await deleteFile(`notes/metadata-shards/${shardFile}`);
    }
  },

  // ── Stash ──
  async listStashFiles() {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const manifest = await window.FirebaseSyncService.getDoc('stash', 'manifest');
      if (Array.isArray(manifest)) return manifest;
      const allStashDocs = await window.FirebaseSyncService.getAllDocs('stash');
      return allStashDocs.filter(d => d.id !== 'manifest').map(d => d.id);
    }

    if (window.AppBridge?.fs?.hasNativeFS()) {
      try {
        const files = await window.AppBridge.fs.listFiles('stash');
        if (files !== null) {
          return (files || [])
            .filter(f => (f.isFile || !f.isDirectory) && (f.name.endsWith('.txt') || f.name.endsWith('.md')))
            .map(f => f.name);
        }
      } catch (e) {
        return [];
      }
    }
    try {
      if (typeof rootHandle === 'undefined' || !rootHandle) return [];
      const dir = await getOrCreateDirHandle('stash');
      const files = [];
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'file' && (name.endsWith('.txt') || name.endsWith('.md'))) {
          files.push(name);
        }
      }
      return files;
    } catch (e) {
      console.warn('StorageAPI.listStashFiles failed', e);
      return [];
    }
  },

  async readStashContent(name) {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const doc = await window.FirebaseSyncService.getDoc('stash', name);
      return doc?.content !== undefined ? doc.content : (typeof doc === 'string' ? doc : '');
    }
    return await readFile(`stash/${name}`);
  },

  async writeStashContent(name, content) {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      await window.FirebaseSyncService.putDoc('stash', name, { name, content, updatedAt: Date.now() });
      const currentList = await this.listStashFiles();
      if (!currentList.includes(name)) {
        currentList.push(name);
        await window.FirebaseSyncService.putDoc('stash', 'manifest', currentList);
      }
      return;
    }
    await writeFile(`stash/${name}`, content);
  },

  async deleteStashFile(name) {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      await window.FirebaseSyncService.deleteDoc('stash', name);
      const currentList = (await this.listStashFiles()).filter(f => f !== name);
      await window.FirebaseSyncService.putDoc('stash', 'manifest', currentList);
      return;
    }
    await deleteFile(`stash/${name}`);
  },

  // ── Chat History ──
  async readChatHistory() {
    return await this.readDocEntity('chat', 'history', '.secretary/chat-history.json', null);
  },

  async writeChatHistory(chatHistory) {
    await this.writeDocEntity('chat', 'history', '.secretary/chat-history.json', chatHistory);
  },

  /**
   * Helper to robustly collect all topic memories / workstreams from disk, in-memory cache, and localStorage
   */
  async _collectTopicMemories(backupDir = null) {
    let topicMemoriesIndex = await this._readJSON('raw/topic-memories/index.json', null);
    if (!topicMemoriesIndex && backupDir) {
      topicMemoriesIndex = await this._readJSON(`${backupDir}/raw/topic-memories/index.json`, null);
    }
    if (!topicMemoriesIndex && typeof _topicMemoriesIndexCache !== 'undefined' && _topicMemoriesIndexCache && Array.isArray(_topicMemoriesIndexCache.topics)) {
      topicMemoriesIndex = _topicMemoriesIndexCache;
    }
    if (!topicMemoriesIndex && typeof localStorage !== 'undefined') {
      try {
        const cached = localStorage.getItem('secretary_topic_memories_index_v1') || localStorage.getItem('secretary_topic_memories_index');
        if (cached) topicMemoriesIndex = JSON.parse(cached);
      } catch (e) {}
    }
    if (!topicMemoriesIndex || !Array.isArray(topicMemoriesIndex.topics)) {
      topicMemoriesIndex = { topics: [] };
    }

    const topicMemoriesList = [];
    const seenKeys = new Set();

    for (const top of topicMemoriesIndex.topics) {
      if (!top) continue;
      const k = top.key || top.topicName;
      if (!k) continue;
      const sanitized = (typeof sanitizeTopicMemoryKey === 'function' ? sanitizeTopicMemoryKey(k) : k) || k;
      if (seenKeys.has(sanitized)) continue;
      seenKeys.add(sanitized);

      let mem = await this._readJSON(`raw/topic-memories/${sanitized}.json`, null)
        || (k !== sanitized ? await this._readJSON(`raw/topic-memories/${k}.json`, null) : null);

      if (!mem && backupDir) {
        mem = await this._readJSON(`${backupDir}/raw/topic-memories/${sanitized}.json`, null)
          || (k !== sanitized ? await this._readJSON(`${backupDir}/raw/topic-memories/${k}.json`, null) : null);
      }

      if (!mem && typeof _topicMemoryFileCache !== 'undefined' && _topicMemoryFileCache instanceof Map) {
        mem = _topicMemoryFileCache.get(sanitized) || _topicMemoryFileCache.get(k) || null;
      }

      if (!mem && typeof localStorage !== 'undefined') {
        try {
          const cached = localStorage.getItem(`secretary_topic_memory_${sanitized}`) || localStorage.getItem(`secretary_topic_memory_${k}`);
          if (cached) mem = JSON.parse(cached);
        } catch (e) {}
      }

      if (mem) {
        topicMemoriesList.push({ key: sanitized, data: mem });
      }
    }

    // Also include any topic dossiers in _topicMemoryFileCache not present in index
    if (typeof _topicMemoryFileCache !== 'undefined' && _topicMemoryFileCache instanceof Map) {
      for (const [ck, cMem] of _topicMemoryFileCache.entries()) {
        if (ck && cMem && !seenKeys.has(ck)) {
          seenKeys.add(ck);
          topicMemoriesList.push({ key: ck, data: cMem });
        }
      }
    }

    return {
      index: topicMemoriesIndex,
      memories: topicMemoriesList
    };
  },

  // ── Utilities & Directory Helpers ──
  async listNoteFiles(subDir = 'notes') {
    if (window.AppBridge?.fs?.hasNativeFS()) {
      return await this._walkHtmlFilesElectron(subDir);
    }
    try {
      if (typeof rootHandle === 'undefined' || !rootHandle) return [];
      const notesDir = await getDirHandle(subDir);
      return await this._walkHtmlFiles(notesDir, subDir);
    } catch (e) {
      console.warn(`StorageAPI.listNoteFiles(${subDir}) failed`, e);
      return [];
    }
  },

  async _walkHtmlFilesElectron(subDir = 'notes') {
    const SKIP_DIRS = new Set(['topics', '_assets']);
    let files = [];
    try {
      const entries = await window.AppBridge.fs.listFiles(subDir);
      for (const ent of (entries || [])) {
        const itemSubPath = `${subDir}/${ent.name}`;
        if ((ent.isFile || !ent.isDirectory) && ent.name.endsWith('.html')) {
          files.push(itemSubPath);
        } else if (ent.isDirectory && !SKIP_DIRS.has(ent.name) && !ent.name.startsWith('_')) {
          const subFiles = await this._walkHtmlFilesElectron(itemSubPath);
          files = files.concat(subFiles);
        }
      }
    } catch (e) {}
    return files;
  },

  async _walkHtmlFiles(dirHandle, pathPrefix = 'notes') {
    const SKIP_DIRS = new Set(['topics', '_assets']);
    let files = [];
    for await (const [name, handle] of dirHandle.entries()) {
      const relPath = `${pathPrefix}/${name}`;
      if (handle.kind === 'file' && name.endsWith('.html')) {
        files.push(relPath);
      } else if (handle.kind === 'directory' && !SKIP_DIRS.has(name) && !name.startsWith('_')) {
        files = files.concat(await this._walkHtmlFiles(handle, relPath));
      }
    }
    return files;
  },

  async listAssetFiles(subDir = 'notes/_assets') {
    const exts = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif', '.svg', '.avif', '.ico', '.bmp']);
    const results = [];
    if (window.AppBridge?.fs?.hasNativeFS()) {
      try {
        const entries = await window.AppBridge.fs.listFiles(subDir);
        for (const ent of (entries || [])) {
          if (ent.isFile || !ent.isDirectory) {
            const lower = ent.name.toLowerCase();
            if ([...exts].some(ext => lower.endsWith(ext))) {
              results.push(`${subDir}/${ent.name}`);
            }
          }
        }
      } catch (e) {}
      return results;
    }
    try {
      if (typeof rootHandle === 'undefined' || !rootHandle) return [];
      const dirHandle = await getDirHandle(subDir);
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'file') {
          const lower = name.toLowerCase();
          if ([...exts].some(ext => lower.endsWith(ext))) {
            results.push(`${subDir}/${name}`);
          }
        }
      }
    } catch (e) {}
    return results;
  },

  async listLegacyTodoMdFiles(priority) {
    return await listMdFiles(`todos/${priority}`);
  },

  async deleteLegacyTodoFile(priority, filename) {
    await deleteFile(`todos/${priority}/${filename}`);
  },

  async deleteLegacyTodoOrderFile() {
    await deleteFile('todos/_order.json');
  },

  async getUniqueNotePath(dirPath, baseName, ext) {
    return await uniqueFilePath(dirPath, baseName, ext);
  },

  // ── Storage Event Bus ──
  _listeners: new Map(),

  on(event, handler) {
    if (!this._listeners) this._listeners = new Map();
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  },

  off(event, handler) {
    if (!this._listeners || !this._listeners.has(event)) return;
    this._listeners.get(event).delete(handler);
  },

  emit(event, data = {}) {
    if (!this._listeners || !this._listeners.has(event)) return;
    for (const handler of this._listeners.get(event)) {
      try { handler(data); } catch (err) { console.warn(`StorageAPI event listener error (${event}):`, err); }
    }
  },

  // ── Asset Management ──
  async writeAsset(relPath, fullDataUrl) {
    if (typeof fullDataUrl === 'string' && fullDataUrl.includes('data:image/svg+xml') && (fullDataUrl.includes('Image not loaded') || fullDataUrl.includes('locked'))) {
      console.warn('[StorageAPI] Refusing to persist placeholder SVG as real asset:', relPath);
      return;
    }
    // 1. Write to Tier 1 (RAM & IndexedDB) immediately
    await this._persistAssetTier1(relPath, fullDataUrl);

    // 2. Dispatch to Asynchronous Connector
    try {
      this.setConnectorStatus('syncing');

      if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.saveAsset) {
        await window.FirebaseSyncService.saveAsset(relPath, fullDataUrl);
      }
      await writeFile(relPath, fullDataUrl);

      this.setConnectorStatus('synced');
    } catch (e) {
      const errorInfo = this.classifyConnectorError(e);
      this.setConnectorStatus('error', errorInfo);
      this.notifyConnectorError(errorInfo);
      throw e;
    }

    this.emit('storage:change', { entity: 'assets', id: relPath, action: 'save' });
  },

  async readAsset(relPath) {
    if (!relPath) return null;
    const clean = String(relPath).replace(/^[./\\]+/, '').replace(/^notes\//, '').replace(/^(_assets|assets)\//, '');
    const fileName = clean.split('/').pop() || clean;

    // 1. RAM Cache (0ms)
    const ramCache = (typeof _assetDataUrlCache !== 'undefined' ? _assetDataUrlCache : null) || (typeof window !== 'undefined' ? window._assetDataUrlCache : null);
    if (ramCache && typeof ramCache.get === 'function') {
      const fromRam = ramCache.get(relPath) || ramCache.get(fileName) || ramCache.get(`notes/_assets/${fileName}`) || ramCache.get(`_assets/${fileName}`);
      if (fromRam && !(typeof fromRam === 'string' && fromRam.includes('data:image/svg+xml') && (fromRam.includes('Image not loaded') || fromRam.includes('locked')))) {
        return fromRam;
      }
    }

    // 2. IndexedDB (fast local persistence)
    const idb = (typeof VaultIDBStorage !== 'undefined' ? VaultIDBStorage : null) || (typeof window !== 'undefined' ? window.VaultIDBStorage : null);
    if (idb && typeof idb.getRecord === 'function') {
      try {
        const found = await idb.getRecord('assets', fileName) || await idb.getRecord('assets', `notes/_assets/${fileName}`) || await idb.getRecord('assets', relPath);
        if (found && (found.data || found.content)) {
          const val = found.data || found.content;
          if (val && !(typeof val === 'string' && val.includes('data:image/svg+xml') && (val.includes('Image not loaded') || val.includes('locked')))) {
            if (ramCache && typeof ramCache.set === 'function') {
              ramCache.set(relPath, val);
              ramCache.set(fileName, val);
            }
            return val;
          }
        }
      } catch (e) {}
    }

    // 3. Active Connector (Firebase or Filesystem)
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.getAsset) {
      const asset = await window.FirebaseSyncService.getAsset(fileName) || await window.FirebaseSyncService.getAsset(relPath);
      if (asset) {
        if (idb && typeof idb.putRecord === 'function') {
          idb.putRecord('assets', { id: fileName, data: String(asset), updatedAt: Date.now() }).catch(() => {});
        }
        return asset;
      }
    }
    if (typeof readAssetAsDataUrl === 'function') {
      const fromFs = await readAssetAsDataUrl(relPath);
      if (fromFs) {
        if (idb && typeof idb.putRecord === 'function') {
          idb.putRecord('assets', { id: fileName, data: String(fromFs), updatedAt: Date.now() }).catch(() => {});
        }
        return fromFs;
      }
    }
    if (window.AppBridge?.fs?.readAsset) {
      const fromBridge = await window.AppBridge.fs.readAsset(relPath);
      if (fromBridge) return fromBridge;
    }
    return null;
  },

  // ── Semantic Repository Namespaces (DAO Helpers) ──
  get notes() {
    return {
      get: (pathOrId) => this.readNoteContent(pathOrId),
      save: (pathOrId, content, meta = {}) => this.writeNoteContent(pathOrId, content, meta),
      delete: (pathOrId) => this.deleteNoteContent(pathOrId),
      list: (subDir) => this.listNoteFiles(subDir),
      has: (pathOrId) => this.hasNoteContent(pathOrId),
      getManifest: () => this.readNotesManifest(),
      saveManifest: (manifest) => this.writeNotesManifest(manifest)
    };
  },

  get docs() {
    return {
      get: (kind, docId, fallback = null) => {
        const defaultFile = `${kind}.json`;
        return this.readDocEntity(kind, docId, defaultFile, fallback);
      },
      save: (kind, docId, payload) => {
        const defaultFile = `${kind}.json`;
        return this.writeDocEntity(kind, docId, defaultFile, payload);
      },
      has: (kind, docId) => {
        const defaultFile = `${kind}.json`;
        return this.hasDocEntity(kind, docId, defaultFile);
      },
      exists: (kind, docId) => {
        const defaultFile = `${kind}.json`;
        return this.hasDocEntity(kind, docId, defaultFile);
      }
    };
  },

  get assets() {
    return {
      get: (relPath) => this.readAsset(relPath),
      save: (relPath, content) => this.writeAsset(relPath, content),
      list: (subDir) => this.listAssetFiles(subDir)
    };
  },

  getPipeline() {
    if (typeof SyncPipeline !== 'undefined') return SyncPipeline;
    if (typeof window !== 'undefined' && window.SyncPipeline) return window.SyncPipeline;
    if (typeof globalThis !== 'undefined' && globalThis.SyncPipeline) return globalThis.SyncPipeline;
    return null;
  },

  get pipeline() {
    return this.getPipeline();
  },

  _getMigrator() {
    if (typeof StorageMigration !== 'undefined') return StorageMigration;
    if (typeof window !== 'undefined' && window.StorageMigration) return window.StorageMigration;
    if (typeof globalThis !== 'undefined' && globalThis.StorageMigration) return globalThis.StorageMigration;
    try {
      const _req = typeof require === 'function' ? require : (typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function' ? process.getBuiltinModule : null);
      if (_req) {
        const _p = _req('path');
        const _fs = _req('fs');
        const _migPath = _p.resolve(process.cwd(), 'js/storage-migration.js');
        if (_fs && _fs.existsSync && _fs.existsSync(_migPath)) {
          const _vm = _req('vm');
          let _code = _fs.readFileSync(_migPath, 'utf-8');
          _code = _code.replace(/^(const|let)\s+([a-zA-Z0-9_$]+)/gm, 'var $2');
          _vm.runInThisContext(_code, { filename: _migPath });
          if (typeof StorageMigration !== 'undefined') return StorageMigration;
          if (typeof window !== 'undefined' && window.StorageMigration) return window.StorageMigration;
          if (typeof globalThis !== 'undefined' && globalThis.StorageMigration) return globalThis.StorageMigration;
        }
      }
    } catch (_e) {}
    throw new Error('StorageMigration subsystem module is not loaded');
  },

  mergeNoteContents(originalHtml, newHtml) {
    try {
      return this._getMigrator().mergeNoteContents(originalHtml, newHtml);
    } catch {
      return newHtml || originalHtml || '';
    }
  },

  // ── Decoupled Migration & Reconciliation Forwarders ──
  async migrateToFirebase(passphrase, config = {}, onProgress = null) {
    return await this._getMigrator().migrateToFirebase(passphrase, config, onProgress);
  },

  async _collectLocalNoteEntries(options = {}) {
    return await this._getMigrator()._collectLocalNoteEntries(options);
  },

  async detectSyncConflict(options = {}) {
    return await this._getMigrator().detectSyncConflict(options);
  },

  async reconcileLocalAndCloudVault(passphrase, strategy = 'merge_local_priority', options = {}, onProgress = null) {
    return await this._getMigrator().reconcileLocalAndCloudVault(passphrase, strategy, options, onProgress);
  },

  async reconcileMigrationBackup(config = {}, onProgress = null) {
    return await this._getMigrator().reconcileMigrationBackup(config, onProgress);
  },

  async fillMigrationGaps(passphrase, config = {}, onProgress = null) {
    return await this._getMigrator().fillMigrationGaps(passphrase, config, onProgress);
  },

  async _archiveLocalFilesAfterMigration(backupDir = '_migrated_to_cloud_backup', data = {}) {
    return await this._getMigrator()._archiveLocalFilesAfterMigration(backupDir, data);
  },

  async revertToFilesystem(onProgress = null) {
    return await this._getMigrator().revertToFilesystem(onProgress);
  },

  async wipeAllLocalData(options = {}) {
    // 1. Delete operational IndexedDB store
    try {
      if (typeof VaultIDBStorage !== 'undefined' && typeof VaultIDBStorage.deleteDatabase === 'function') {
        await VaultIDBStorage.deleteDatabase();
      }
    } catch (e) {
      console.warn('StorageAPI.wipeAllLocalData: VaultIDBStorage.deleteDatabase failed', e);
    }

    // 2. Delete secretary-app handle IndexedDB database
    try {
      const idb = typeof window !== 'undefined' ? (window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB) : null;
      if (idb && typeof idb.deleteDatabase === 'function') {
        await new Promise(resolve => {
          const req = idb.deleteDatabase('secretary-app');
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
          req.onblocked = () => resolve(true);
        });
      }
    } catch (e) {
      console.warn('StorageAPI.wipeAllLocalData: delete secretary-app IDB failed', e);
    }

    // 3. Delete any other Secretary IndexedDB databases found if supported
    try {
      const idb = typeof window !== 'undefined' ? (window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB) : null;
      if (idb && typeof idb.databases === 'function') {
        const dbs = await idb.databases();
        if (Array.isArray(dbs)) {
          for (const dbInfo of dbs) {
            if (dbInfo && dbInfo.name && (dbInfo.name.includes('Secretary') || dbInfo.name.includes('secretary'))) {
              try {
                idb.deleteDatabase(dbInfo.name);
              } catch (_e) {}
            }
          }
        }
      }
    } catch (_e) {}

    // 4. Clear localStorage items (including email link tokens and pending auth state)
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('secretary_email_link_email');
        localStorage.removeItem('secretary_magic_link_pending_pass');
        localStorage.removeItem('secretary_pending_email_link');
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('secretary') || k.startsWith('Secretary') || k.includes('vault') || k.includes('topic_memories'))) {
            keysToRemove.push(k);
          }
        }
        for (const k of keysToRemove) {
          localStorage.removeItem(k);
        }
        if (options.clearEntireLocalStorage) {
          localStorage.clear();
        }
      } catch (e) {
        console.warn('StorageAPI.wipeAllLocalData: localStorage cleanup failed', e);
      }
    }

    // 5. Clear sessionStorage & scrub any magic link tokens from browser address bar
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.clear();
      } catch (e) {}
    }
    if (typeof window !== 'undefined' && window.history?.replaceState && window.location) {
      if (window.location.search?.includes('apiKey') || window.location.search?.includes('oobCode') || window.location.search?.includes('mode=signIn')) {
        try {
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch (_e) {}
      }
    }

    // 6. Purge Firebase sync service local memory, email identity, and lock vault
    if (typeof window !== 'undefined' && window.FirebaseSyncService) {
      try {
        if (window.FirebaseSyncService.state) {
          window.FirebaseSyncService.state.userEmail = null;
          window.FirebaseSyncService.state.userId = 'default_user';
        }
        if (typeof window.FirebaseSyncService.lockVault === 'function') {
          window.FirebaseSyncService.lockVault();
        }
        if (typeof window.FirebaseSyncService.clearSavedPassphrase === 'function') {
          await window.FirebaseSyncService.clearSavedPassphrase();
        }
      } catch (e) {}
    }

    // Clear settings references to sync emails and vault metadata
    if (typeof settings !== 'undefined' && settings) {
      delete settings.vaultMeta;
      delete settings.vaultId;
      delete settings.lastSyncEmail;
    }

    // 7. Clear in-memory manifests and handle
    if (typeof globalThis !== 'undefined') {
      if (typeof globalThis.manifest !== 'undefined') globalThis.manifest = [];
      if (typeof globalThis.todosManifest !== 'undefined') globalThis.todosManifest = [];
      if (typeof globalThis.plannerEvents !== 'undefined') globalThis.plannerEvents = [];
      globalThis.rootHandle = null;
    }
    if (typeof window !== 'undefined') {
      if (typeof window.manifest !== 'undefined') window.manifest = [];
      if (typeof window.todosManifest !== 'undefined') window.todosManifest = [];
      if (typeof window.plannerEvents !== 'undefined') window.plannerEvents = [];
      window.rootHandle = null;
      if (window.CalendarSyncService?.clearExternalAgentSession) {
        window.CalendarSyncService.clearExternalAgentSession();
      }
    }

    // 8. Reset UI to welcome screen
    if (typeof window !== 'undefined') {
      const sm = document.getElementById('screen-main');
      if (sm) sm.classList.remove('active');
      const sc = document.getElementById('screen-connect');
      if (sc) {
        sc.style.display = '';
        sc.classList.remove('loading');
      }
      if (typeof showLandingStep === 'function') {
        showLandingStep('welcome');
      }
      if (typeof updateCloudSyncUI === 'function') {
        updateCloudSyncUI();
      }
    }

    return true;
  }
};

window.StorageAPI = StorageAPI;

