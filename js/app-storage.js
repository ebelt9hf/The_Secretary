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
      window.FirebaseSyncService.state.engine = this._storageEngine;
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

  // ── Todos Manifest ──
  async readTodosManifest() {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const todos = await window.FirebaseSyncService.getDoc('todos', 'manifest');
      return Array.isArray(todos) ? todos : [];
    }
    return await this._readJSON('todos/manifest.json', []);
  },

  async writeTodosManifest(todosManifest) {
    if (this.getStorageEngine() !== 'firebase') {
      await this._writeJSON('todos/manifest.json', todosManifest);
    }
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      await window.FirebaseSyncService.putDoc('todos', 'manifest', todosManifest);
    }
  },

  async hasTodosManifest() {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const doc = await window.FirebaseSyncService.getDoc('todos', 'manifest');
      return doc !== null && doc !== undefined;
    }
    return await fileExists('todos/manifest.json');
  },

  // ── Planner Events ──
  async readPlanner() {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      return await window.FirebaseSyncService.getDoc('planner', 'events');
    }
    return await this._readJSON('planner.json', null);
  },

  async writePlanner(plannerData) {
    if (this.getStorageEngine() !== 'firebase') {
      await this._writeJSON('planner.json', plannerData);
    }
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      await window.FirebaseSyncService.putDoc('planner', 'events', plannerData);
    }
  },

  async hasPlanner() {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const doc = await window.FirebaseSyncService.getDoc('planner', 'events');
      return doc !== null && doc !== undefined;
    }
    return await fileExists('planner.json');
  },

  // ── Planner Proposals (External Agent Proposed Events - ALWAYS LOCAL FILE) ──
  async readPlannerProposals() {
    try {
      return await this._readJSON('planner-proposals.json', null);
    } catch {
      return null;
    }
  },

  async writePlannerProposals(proposalsData) {
    try {
      await this._writeJSON('planner-proposals.json', proposalsData);
    } catch (e) {
      console.warn('writePlannerProposals failed:', e);
    }
  },

  async hasPlannerProposals() {
    try {
      return await fileExists('planner-proposals.json');
    } catch {
      return false;
    }
  },

  // ── Colleagues ──
  async readColleagues() {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      return await window.FirebaseSyncService.getDoc('colleagues', 'database');
    }
    return await this._readJSON('colleagues.json', null);
  },

  async writeColleagues(colleaguesDb) {
    if (this.getStorageEngine() !== 'firebase') {
      await this._writeJSON('colleagues.json', colleaguesDb);
    }
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      await window.FirebaseSyncService.putDoc('colleagues', 'database', colleaguesDb);
    }
  },

  async hasColleagues() {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const doc = await window.FirebaseSyncService.getDoc('colleagues', 'database');
      return doc !== null && doc !== undefined;
    }
    return await fileExists('colleagues.json');
  },

  async readColleaguesMigration() {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      return await window.FirebaseSyncService.getDoc('colleagues', 'migration_v1_done');
    }
    return await this._readJSON('.secretary/colleagues-migration-v1.done', null);
  },

  async writeColleaguesMigration(data) {
    if (this.getStorageEngine() !== 'firebase') {
      await this._writeJSON('.secretary/colleagues-migration-v1.done', data);
    }
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      await window.FirebaseSyncService.putDoc('colleagues', 'migration_v1_done', data);
    }
  },

  async hasColleaguesMigration() {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const doc = await window.FirebaseSyncService.getDoc('colleagues', 'migration_v1_done');
      return doc !== null && doc !== undefined;
    }
    return await fileExists('.secretary/colleagues-migration-v1.done');
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

  async readSettings(path) {
    const local = (await this._readJSON(path || 'secretary-settings.json', null)) || {};
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      try {
        const cloudSettings = await window.FirebaseSyncService.getDoc('settings', 'config');
        if (cloudSettings && typeof cloudSettings === 'object') {
          const localAi = (local && local.ai) || {};
          const cloudAi = (cloudSettings && cloudSettings.ai) || {};
          return {
            ...local,
            ...cloudSettings,
            ui: { ...(local.ui || {}), ...(cloudSettings.ui || {}) },
            ai: {
              ...cloudAi,
              ...localAi // Preserves local API keys and endpoints
            }
          };
        }
      } catch (e) {
        console.warn('Failed reading cloud settings:', e);
      }
    }
    return local && Object.keys(local).length > 0 ? local : null;
  },

  async writeSettings(settings) {
    await this._writeJSON('secretary-settings.json', settings);
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
    if (this._noteCache.has(path)) {
      return this._noteCache.get(path);
    }

    if (this.getStorageEngine() === 'firebase') {
      if (typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
        const noteId = window.FirebaseSyncService._normalizeId
          ? window.FirebaseSyncService._normalizeId(path)
          : path.replace(/^notes\//, '').replace(/\.html$/, '');
        const firebaseNote = await window.FirebaseSyncService.getNote(noteId);
        if (firebaseNote) {
          const content = firebaseNote.contentHtml || firebaseNote.html || '';
          this._noteCache.set(path, content);
          return content;
        }
      }
      return '';
    }

    // Local filesystem mode
    try {
      const content = await readFile(path);
      if (content && typeof content === 'string') {
        this._noteCache.set(path, content);
        return content;
      }
    } catch (e) {}

    const err = new Error(`File not found: ${path}`);
    err.name = 'NotFoundError';
    throw err;
  },

  async writeNoteContent(path, content, meta = {}) {
    // 1. Write to local filesystem only if in filesystem mode
    if (this.getStorageEngine() !== 'firebase') {
      try {
        await writeFile(path, content);
      } catch (e) {
        throw e;
      }
    }

    if (path) {
      this._noteCache.set(path, content);
    }

    // 2. Sync to Firebase local cache & cloud if unlocked
    if (typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const noteId = meta.id || path.replace(/^notes\//, '').replace(/\.html$/, '');
      const isDummy = (t, id) => !t || t === id || t === 'Untitled' || t === 'Untitled Note' || /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(t) || /^note[-_]/.test(t);
      let resolvedTitle = meta.title;
      if (isDummy(resolvedTitle, noteId) && content && typeof parseNoteHTML === 'function') {
        try {
          const parsed = parseNoteHTML(content);
          if (parsed.title && !isDummy(parsed.title, noteId)) {
            resolvedTitle = parsed.title;
          }
        } catch (e) {}
      }
      await window.FirebaseSyncService.queueSyncNote({
        id: noteId,
        path,
        contentHtml: content,
        title: resolvedTitle || meta.title || noteId,
        date: meta.date,
        tags: meta.tags,
        workstream: meta.workstream,
        pinned: meta.pinned,
        archived: meta.archived,
        favorite: meta.favorite,
        updatedAt: Date.now()
      });
    }
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
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      return await window.FirebaseSyncService.getDoc('chat', 'history');
    }
    return await this._readJSON('.secretary/chat-history.json', null);
  },

  async writeChatHistory(chatHistory) {
    if (this.getStorageEngine() !== 'firebase') {
      await this._writeJSON('.secretary/chat-history.json', chatHistory);
    }
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      await window.FirebaseSyncService.putDoc('chat', 'history', chatHistory);
    }
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

  mergeNoteContents(originalHtml, newHtml) {
    if (!originalHtml || typeof originalHtml !== 'string' || !originalHtml.trim()) {
      return newHtml || '';
    }
    if (!newHtml || typeof newHtml !== 'string' || !newHtml.trim()) {
      return originalHtml;
    }

    const parsedOrig = (typeof parseNoteHTML === 'function') ? parseNoteHTML(originalHtml) : { mainHTML: originalHtml };
    const parsedNew = (typeof parseNoteHTML === 'function') ? parseNoteHTML(newHtml) : { mainHTML: newHtml };

    const origText = (typeof htmlToPlainText === 'function' ? htmlToPlainText(parsedOrig.mainHTML || '') : (parsedOrig.mainHTML || '')).replace(/\s+/g, ' ').trim();
    const newText = (typeof htmlToPlainText === 'function' ? htmlToPlainText(parsedNew.mainHTML || '') : (parsedNew.mainHTML || '')).replace(/\s+/g, ' ').trim();

    // If new HTML has no substantive body text (e.g. empty template <p></p> generated by opening note editor while empty)
    if (!newText) {
      return originalHtml;
    }

    // If both texts are identical or one is fully contained in the other
    if (origText === newText || origText.includes(newText)) {
      return originalHtml;
    }
    if (newText.includes(origText)) {
      // User edited on top of original note: keep newHtml
      return newHtml;
    }

    // Both have distinct substantive content: use original (from backup) and append the new one!
    const origBody = (parsedOrig.mainHTML || '').trim();
    const newBody = (parsedNew.mainHTML || '').trim();
    const mergedMainHTML = `${origBody}\n<hr class="note-merged-divider">\n<p><strong>[Appended edits]</strong></p>\n${newBody}`;

    const mergeArrays = (a = [], b = []) => Array.from(new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]));
    const group_tags = mergeArrays(parsedOrig.group_tags, parsedNew.group_tags);
    const major_topic_tags = mergeArrays(parsedOrig.major_topic_tags, parsedNew.major_topic_tags);
    const topic_tags = mergeArrays(parsedOrig.topic_tags, parsedNew.topic_tags);
    const extra_tags = mergeArrays(parsedOrig.extra_tags, parsedNew.extra_tags);
    const workstreams = mergeArrays(parsedOrig.workstreams, parsedNew.workstreams);

    let mergedSummary = parsedNew.summary || parsedOrig.summary || '';
    if (parsedOrig.summary && parsedNew.summary && parsedOrig.summary !== parsedNew.summary) {
      mergedSummary = `${parsedOrig.summary}\n${parsedNew.summary}`;
    }

    const isDummy = (t, id) => !t || t === id || t === 'Untitled' || t === 'Untitled Note' || /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(t) || /^note[-_]/.test(t);
    const title = (!isDummy(parsedOrig.title, parsedOrig.id) ? parsedOrig.title : (!isDummy(parsedNew.title, parsedNew.id) ? parsedNew.title : (parsedOrig.title || parsedNew.title || 'Untitled Note')));

    const changes = {
      title,
      date: parsedNew.date || parsedOrig.date || new Date().toISOString().slice(0, 10),
      group_tags,
      major_topic_tags,
      topic_tags,
      extra_tags,
      workstream: (workstreams.length > 0) ? workstreams.join(', ') : (parsedNew.workstream || parsedOrig.workstream || ''),
      workstreams,
      reviewed: parsedNew.reviewed || parsedOrig.reviewed || false,
      mainHTML: mergedMainHTML,
      summary: mergedSummary
    };

    if (typeof applyNoteEdits === 'function') {
      return applyNoteEdits(originalHtml, changes);
    }
    return originalHtml;
  },

  // ── Dual-Engine Migration Assistent Helpers ──
  async migrateToFirebase(passphrase, config = {}, onProgress = null) {
    if (typeof window === 'undefined' || !window.FirebaseSyncService) {
      throw new Error('FirebaseSyncService is not available');
    }

    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'collecting',
        percent: 5,
        message: typeof t === 'function' ? t('sync.migrationProgressCollecting') : 'Collecting local notes and documents…'
      });
    }

    const backupDir = config.backupDir || '_migrated_to_cloud_backup';

    // 1. Collect notes comprehensively (from manifest.json, metadata-buffer.json, metadata shards, in-memory manifest/buffer, and filesystem)
    const manifestFromDisk = await this._readJSON('notes/manifest.json', []);
    const mbFromDisk = await this._readJSON('notes/metadata-buffer.json', { items: [] });
    const inMemoryManifest = (typeof window !== 'undefined' && Array.isArray(window.manifest)) ? window.manifest : [];
    const inMemoryMetadata = (typeof window !== 'undefined' && Array.isArray(window.metadataBuffer)) ? window.metadataBuffer : [];

    // Also read metadata shards from disk if available
    let shardItemsFromDisk = [];
    try {
      const shardsIndex = await this.readMetadataShardsIndex();
      if (Array.isArray(shardsIndex?.shardFiles)) {
        for (const sf of shardsIndex.shardFiles) {
          const parsed = await this.readMetadataShard(sf);
          if (Array.isArray(parsed?.items)) {
            shardItemsFromDisk = shardItemsFromDisk.concat(parsed.items);
          }
        }
      }
    } catch (e) {}

    const noteMap = new Map();
    for (const item of [
      ...manifestFromDisk,
      ...(Array.isArray(mbFromDisk?.items) ? mbFromDisk.items : []),
      ...shardItemsFromDisk,
      ...inMemoryManifest,
      ...inMemoryMetadata
    ]) {
      if (!item) continue;
      const rawId = item.id || (item.path ? item.path.replace(/^notes\//i, '').replace(/\.html$/i, '') : null);
      const cleanPath = item.path || (rawId ? `notes/${rawId}.html` : null);
      if (cleanPath && !noteMap.has(cleanPath)) {
        noteMap.set(cleanPath, { ...item, id: rawId || item.id, path: cleanPath });
      }
    }

    // Walk local notes/ directory to catch all untracked notes
    try {
      const htmlFiles = await this.listNoteFiles('notes');
      for (const relPath of (Array.isArray(htmlFiles) ? htmlFiles : [])) {
        const normPath = relPath.startsWith('notes/') ? relPath : `notes/${relPath}`;
        if (!noteMap.has(normPath)) {
          const id = normPath.replace(/^notes\//i, '').replace(/\.html$/i, '');
          noteMap.set(normPath, { id, path: normPath, title: '' });
        }
      }
    } catch (e) {}

    // Also check backup directory if present to recover previously archived notes
    try {
      const backupHtmlFiles = await this.listNoteFiles(`${backupDir}/notes`);
      for (const bPath of (Array.isArray(backupHtmlFiles) ? backupHtmlFiles : [])) {
        const relPath = bPath.replace(new RegExp(`^${backupDir}/`, 'i'), '');
        const normPath = relPath.startsWith('notes/') ? relPath : `notes/${relPath}`;
        if (!noteMap.has(normPath)) {
          const id = normPath.replace(/^notes\//i, '').replace(/\.html$/i, '');
          noteMap.set(normPath, { id, path: normPath, title: '', _fromBackup: true });
        }
      }
    } catch (e) {}

    // Helper to read note HTML across candidate locations
    const tryReadNoteHtml = async (pathOrId, item = {}) => {
      let cached = (this.getNoteFromCache && this.getNoteFromCache(pathOrId))
        || (item.path && this.getNoteFromCache && this.getNoteFromCache(item.path));
      if (cached && typeof cached === 'string' && cached.trim()) return cached;

      const raw = String(pathOrId || item.path || (item.id ? `notes/${item.id}.html` : '')).replace(/\\/g, '/');
      if (!raw) return '';
      const cleanRel = raw.replace(/^notes\//i, '');
      const cleanId = cleanRel.replace(/\.html$/i, '');

      const candidates = [
        raw,
        raw.startsWith('notes/') ? cleanRel : `notes/${raw}`,
        `notes/${cleanId}.html`,
        `${cleanId}.html`,
        `${backupDir}/${raw}`,
        `${backupDir}/notes/${cleanRel}`,
        `${backupDir}/notes/${cleanId}.html`,
        `_migrated_to_cloud_backup/notes/${cleanId}.html`,
        `_migrated_to_cloud_backup/${cleanRel}`
      ];

      const seen = new Set();
      for (const cand of candidates) {
        if (!cand || seen.has(cand)) continue;
        seen.add(cand);
        try {
          const text = await readFile(cand);
          if (text && typeof text === 'string' && text.trim()) {
            return text;
          }
        } catch (e) {}
      }
      return '';
    };

    const isDummy = (t, id) => !t || t === id || t === 'Untitled' || t === 'Untitled Note' || /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(t) || /^note[-_]/.test(t);
    const notesToMigrate = [];
    const noteEntries = Array.from(noteMap.values());
    for (let idx = 0; idx < noteEntries.length; idx++) {
      const item = noteEntries[idx];
      let html = await tryReadNoteHtml(item.path, item);
      let parsed = {};
      if (html && typeof parseNoteHTML === 'function') {
        try { parsed = parseNoteHTML(html); } catch (e) {}
      }
      const rawTitle = (!isDummy(item.title, item.id) ? item.title : '');
      const parsedTitle = (!isDummy(parsed.title, item.id) ? parsed.title : '');
      const title = parsedTitle || rawTitle || item.title || item.id || 'Untitled Note';
      notesToMigrate.push({
        ...item,
        title,
        date: item.date || parsed.date || new Date().toISOString().slice(0, 10),
        tags: (item.tags && item.tags.length) ? item.tags : (parsed.tags || []),
        workstream: item.workstream || parsed.workstream || '',
        contentHtml: html || ''
      });
    }

    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'encrypting',
        percent: 15,
        message: typeof t === 'function' ? t('sync.migrationProgressEncrypting') : 'Encrypting notes with AES-256-GCM…'
      });
    }

    // 2. Collect additional stores
    let todosManifest = await this._readJSON('todos/manifest.json', null);
    if (!todosManifest) todosManifest = await this._readJSON(`${backupDir}/todos/manifest.json`, null);
    if (!todosManifest && typeof window !== 'undefined' && Array.isArray(window.todosManifest) && window.todosManifest.length > 0) {
      todosManifest = window.todosManifest;
    }
    let todosOrder = await this._readJSON('todos/_order.json', null) || await this._readJSON(`${backupDir}/todos/_order.json`, null);
    let planner = await this._readJSON('planner.json', null) || await this._readJSON(`${backupDir}/planner.json`, null);
    let colleagues = await this._readJSON('colleagues.json', null) || await this._readJSON(`${backupDir}/colleagues.json`, null);
    let colleaguesMigration = await this._readJSON('.secretary/colleagues-migration-v1.done', null) || await this._readJSON(`${backupDir}/.secretary/colleagues-migration-v1.done`, null);
    let chatHistory = await this._readJSON('.secretary/chat-history.json', null) || await this._readJSON(`${backupDir}/.secretary/chat-history.json`, null);
    let trashManifest = await this._readJSON('.trash/manifest.json', null) || await this._readJSON(`${backupDir}/.trash/manifest.json`, null);

    const trashNotes = [];
    if (Array.isArray(trashManifest)) {
      for (const t of trashManifest) {
        if (t && t.filename) {
          try {
            const content = await readFile(`.trash/${t.filename}`);
            trashNotes.push({ ...t, content });
          } catch (e) {
            try {
              const content = await readFile(`${backupDir}/.trash/${t.filename}`);
              trashNotes.push({ ...t, content });
            } catch (be) {}
          }
        }
      }
    }

    const stashFiles = [];
    try {
      const stashList = await this.listStashFiles();
      for (const sName of (Array.isArray(stashList) ? stashList : [])) {
        try {
          const content = await readFile(`stash/${sName}`);
          stashFiles.push({ name: sName, content });
        } catch (e) {
          try {
            const content = await readFile(`${backupDir}/stash/${sName}`);
            stashFiles.push({ name: sName, content });
          } catch (be) {}
        }
      }
    } catch (e) {}

    // Collect asset files (images)
    const assetList = [];
    const assetFolders = ['notes/_assets', '_assets', `${backupDir}/notes/_assets`, `${backupDir}/_assets`];
    const seenAssetIds = new Set();
    for (const folder of assetFolders) {
      try {
        const aFiles = await this.listAssetFiles(folder);
        for (const aPath of (Array.isArray(aFiles) ? aFiles : [])) {
          const fileName = aPath.split('/').pop();
          if (!fileName || seenAssetIds.has(fileName)) continue;
          seenAssetIds.add(fileName);
          try {
            const dataUrl = (typeof readAssetAsDataUrl === 'function' ? await readAssetAsDataUrl(aPath) : null)
              || (window.AppBridge?.fs?.readAsset ? await window.AppBridge.fs.readAsset(aPath) : null)
              || (window.AppBridge?.fs?.readAsset ? await window.AppBridge.fs.readAsset(fileName) : null);
            if (dataUrl) {
              assetList.push({ id: fileName, data: dataUrl });
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    // Collect topic memories
    let topicMemoriesIndex = await this._readJSON('raw/topic-memories/index.json', null)
      || await this._readJSON(`${backupDir}/raw/topic-memories/index.json`, null);
    const topicMemoriesList = [];
    if (topicMemoriesIndex && Array.isArray(topicMemoriesIndex.topics)) {
      for (const top of topicMemoriesIndex.topics) {
        const k = top.key || top.topicName;
        if (k) {
          const mem = await this._readJSON(`raw/topic-memories/${k}.json`, null)
            || await this._readJSON(`${backupDir}/raw/topic-memories/${k}.json`, null);
          if (mem) {
            topicMemoriesList.push({ key: k, data: mem });
          }
        }
      }
    }

    const localSettings = (await this._readJSON('secretary-settings.json', null))
      || (await this._readJSON(`${backupDir}/secretary-settings.json`, null))
      || (typeof window !== 'undefined' ? window.settings : null);

    const res = await window.FirebaseSyncService.migrateFromFilesystem(notesToMigrate, passphrase, config, {
      todosManifest,
      todosOrder,
      planner,
      colleagues,
      colleaguesMigration,
      chatHistory,
      trashManifest,
      trashNotes,
      stashFiles,
      assets: assetList,
      topicMemories: {
        index: topicMemoriesIndex,
        memories: topicMemoriesList
      },
      settings: localSettings
    }, (prog) => {
      if (typeof onProgress === 'function') {
        onProgress(prog);
      }
    });

    // 3. Move original local filesystem files to a separate backup folder that the user can delete
    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'archiving',
        percent: 85,
        message: typeof t === 'function' ? t('sync.migrationProgressArchiving') : 'Archiving local files to backup folder…'
      });
    }

    const archiveInfo = await this._archiveLocalFilesAfterMigration(backupDir, {
      notes: notesToMigrate,
      trashNotes,
      stashFiles,
      topicMemories: topicMemoriesList,
      assets: assetList
    });

    this.setStorageEngine('firebase');
    if (typeof settings !== 'undefined' && settings) {
      settings.storageEngine = 'firebase';
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
    }

    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'finalizing',
        percent: 100,
        message: typeof t === 'function' ? t('sync.migrationProgressFinalizing') : 'Migration complete!'
      });
    }

    return {
      ...res,
      archive: archiveInfo
    };
  },

  // ── Sync Conflict Detection & Smart Reconciliation ──
  async detectSyncConflict(options = {}) {
    // 1. Collect local workspace metadata
    let localNotes = [];
    try {
      const manifestFromDisk = await this._readJSON('notes/manifest.json', []);
      const mbFromDisk = await this._readJSON('notes/metadata-buffer.json', { items: [] });
      const inMemManifest = (typeof window !== 'undefined' && Array.isArray(window.manifest)) ? window.manifest : [];
      const inMemBuffer = (typeof window !== 'undefined' && Array.isArray(window.metadataBuffer)) ? window.metadataBuffer : [];
      const diskHtmlFiles = (typeof this.listNoteFiles === 'function') ? (await this.listNoteFiles('notes')) : [];

      const localMap = new Map();
      for (const item of [
        ...manifestFromDisk,
        ...(Array.isArray(mbFromDisk?.items) ? mbFromDisk.items : []),
        ...inMemManifest,
        ...inMemBuffer
      ]) {
        if (!item) continue;
        const rawId = item.id || (item.path ? item.path.replace(/^notes\//i, '').replace(/\.html$/i, '') : null);
        if (rawId && !localMap.has(rawId)) {
          localMap.set(rawId, { ...item, id: rawId, path: item.path || `notes/${rawId}.html` });
        }
      }
      for (const rel of (Array.isArray(diskHtmlFiles) ? diskHtmlFiles : [])) {
        const id = rel.replace(/^notes\//i, '').replace(/\.html$/i, '');
        if (id && !localMap.has(id)) {
          localMap.set(id, { id, path: rel.startsWith('notes/') ? rel : `notes/${rel}` });
        }
      }
      localNotes = Array.from(localMap.values());
    } catch (e) {}

    let localTodos = await this._readJSON('todos/manifest.json', null);
    if (!localTodos && typeof window !== 'undefined' && Array.isArray(window.todosManifest) && window.todosManifest.length > 0) {
      localTodos = window.todosManifest;
    }
    const localPlanner = await this._readJSON('planner.json', null);
    const localColleagues = await this._readJSON('colleagues.json', null);

    const localStats = {
      noteCount: localNotes.length,
      todoCount: Array.isArray(localTodos) ? localTodos.length : 0,
      plannerCount: Array.isArray(localPlanner?.events) ? localPlanner.events.length : 0,
      colleagueCount: Array.isArray(localColleagues?.colleagues || localColleagues) ? (localColleagues.colleagues || localColleagues).length : 0,
      lastModified: Math.max(0, ...localNotes.map(n => n.updatedAt || 0))
    };

    // 2. Collect remote vault metadata
    const remoteNotes = [];
    if (typeof window !== 'undefined' && window.FirebaseSyncService) {
      const syncService = window.FirebaseSyncService;
      if (syncService.state.manifestCache && syncService.state.manifestCache.size > 0) {
        for (const m of syncService.state.manifestCache.values()) {
          if (m && !m.deleted) remoteNotes.push(m);
        }
      } else if (syncService.state.localCache && syncService.state.localCache.size > 0) {
        for (const doc of syncService.state.localCache.values()) {
          if (doc && !doc.deleted) remoteNotes.push(doc);
        }
      }
    }

    let remoteTodos = null;
    let remotePlanner = null;
    let remoteColleagues = null;
    if (typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      try { remoteTodos = await window.FirebaseSyncService.getDoc('todos', 'manifest'); } catch (e) {}
      try { remotePlanner = await window.FirebaseSyncService.getDoc('planner', 'events'); } catch (e) {}
      try { remoteColleagues = await window.FirebaseSyncService.getDoc('colleagues', 'database'); } catch (e) {}
    }

    const remoteStats = {
      noteCount: remoteNotes.length,
      todoCount: Array.isArray(remoteTodos) ? remoteTodos.length : 0,
      plannerCount: Array.isArray(remotePlanner?.events) ? remotePlanner.events.length : 0,
      colleagueCount: Array.isArray(remoteColleagues?.colleagues || remoteColleagues) ? (remoteColleagues.colleagues || remoteColleagues).length : 0,
      lastModified: Math.max(0, ...remoteNotes.map(n => n.updatedAt || 0))
    };

    const localHasData = (localStats.noteCount > 0 || localStats.todoCount > 0 || localStats.plannerCount > 0);
    const remoteHasData = (remoteStats.noteCount > 0 || remoteStats.todoCount > 0 || remoteStats.plannerCount > 0);

    const localIds = new Set(localNotes.map(n => n.id));
    const remoteIds = new Set(remoteNotes.map(n => n.id));
    let sharedCount = 0;
    let differingCount = 0;

    for (const id of localIds) {
      if (remoteIds.has(id)) {
        sharedCount++;
        const lNote = localNotes.find(n => n.id === id);
        const rNote = remoteNotes.find(n => n.id === id);
        if (lNote && rNote && (lNote.bodyHash !== rNote.bodyHash || lNote.updatedAt !== rNote.updatedAt)) {
          differingCount++;
        }
      }
    }

    return {
      hasConflict: localHasData && remoteHasData,
      local: localStats,
      remote: remoteStats,
      sharedNotesCount: sharedCount,
      differingNotesCount: differingCount,
      onlyLocalNotesCount: Math.max(0, localStats.noteCount - sharedCount),
      onlyRemoteNotesCount: Math.max(0, remoteStats.noteCount - sharedCount)
    };
  },

  async reconcileLocalAndCloudVault(passphrase, strategy = 'merge_local_priority', options = {}, onProgress = null) {
    if (typeof window === 'undefined' || !window.FirebaseSyncService) {
      throw new Error('FirebaseSyncService is not available');
    }
    const backupDir = options.backupDir || '_migrated_to_cloud_backup';

    // Strategy: overwrite_cloud
    if (strategy === 'overwrite_cloud') {
      const res = await this.migrateToFirebase(passphrase, { backupDir, ...options }, onProgress);
      return { success: true, ...res, strategy: 'overwrite_cloud' };
    }

    // Strategy: overwrite_local
    if (strategy === 'overwrite_local') {
      if (typeof onProgress === 'function') {
        onProgress({ stage: 'unlocking', percent: 20, message: typeof t === 'function' ? t('sync.reconcileUnlocking') : 'Unlocking remote vault…' });
      }
      if (!window.FirebaseSyncService.state.isUnlocked) {
        const unlocked = await window.FirebaseSyncService.unlockVault(passphrase);
        if (!unlocked) throw new Error('Incorrect passphrase for remote vault');
      }

      if (typeof onProgress === 'function') {
        onProgress({ stage: 'archiving', percent: 60, message: typeof t === 'function' ? t('sync.migrationProgressArchiving') : 'Archiving local files to backup folder…' });
      }

      // Collect all local items to archive
      const localFiles = await this.listNoteFiles('notes');
      const notesToArchive = (Array.isArray(localFiles) ? localFiles : []).map(p => ({
        id: p.replace(/^notes\//, '').replace(/\.html$/, ''),
        path: p.startsWith('notes/') ? p : `notes/${p}`
      }));

      await this._archiveLocalFilesAfterMigration(backupDir, { notes: notesToArchive });
      this.setStorageEngine('firebase');
      if (typeof settings !== 'undefined' && settings) {
        settings.storageEngine = 'firebase';
        if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
      }

      if (typeof onProgress === 'function') {
        onProgress({ stage: 'finalizing', percent: 100, message: typeof t === 'function' ? t('sync.migrationProgressFinalizing') : 'Synchronization complete!' });
      }
      return { success: true, strategy: 'overwrite_local' };
    }

    // Strategies: merge_local_priority & merge_remote_priority
    const isLocalPriority = strategy === 'merge_local_priority';

    if (typeof onProgress === 'function') {
      onProgress({ stage: 'unlocking', percent: 15, message: typeof t === 'function' ? t('sync.reconcileUnlocking') : 'Unlocking remote vault…' });
    }

    if (!window.FirebaseSyncService.state.isUnlocked) {
      const unlocked = await window.FirebaseSyncService.unlockVault(passphrase);
      if (!unlocked) {
        await window.FirebaseSyncService.setupVault(passphrase);
      }
    }

    if (typeof onProgress === 'function') {
      onProgress({ stage: 'collecting', percent: 30, message: typeof t === 'function' ? t('sync.migrationProgressCollecting') : 'Collecting local and cloud data…' });
    }

    // 1. Collect local notes
    const manifestFromDisk = await this._readJSON('notes/manifest.json', []);
    const mbFromDisk = await this._readJSON('notes/metadata-buffer.json', { items: [] });
    const inMemManifest = (typeof window !== 'undefined' && Array.isArray(window.manifest)) ? window.manifest : [];
    const inMemBuffer = (typeof window !== 'undefined' && Array.isArray(window.metadataBuffer)) ? window.metadataBuffer : [];
    const diskHtmlFiles = (typeof this.listNoteFiles === 'function') ? (await this.listNoteFiles('notes')) : [];

    const localNoteMap = new Map();
    for (const item of [...manifestFromDisk, ...(Array.isArray(mbFromDisk?.items) ? mbFromDisk.items : []), ...inMemManifest, ...inMemBuffer]) {
      if (!item) continue;
      const rawId = item.id || (item.path ? item.path.replace(/^notes\//i, '').replace(/\.html$/i, '') : null);
      if (rawId && !localNoteMap.has(rawId)) {
        localNoteMap.set(rawId, { ...item, id: rawId, path: item.path || `notes/${rawId}.html` });
      }
    }
    for (const rel of (Array.isArray(diskHtmlFiles) ? diskHtmlFiles : [])) {
      const id = rel.replace(/^notes\//i, '').replace(/\.html$/i, '');
      if (id && !localNoteMap.has(id)) {
        localNoteMap.set(id, { id, path: rel.startsWith('notes/') ? rel : `notes/${rel}` });
      }
    }

    // Helper to read local note content
    const getLocalNoteContent = async (item) => {
      const p = item.path || `notes/${item.id}.html`;
      try {
        const text = await readFile(p);
        if (text) return text;
      } catch (e) {}
      if (item.contentHtml || item.html) return item.contentHtml || item.html;
      return '';
    };

    if (typeof onProgress === 'function') {
      onProgress({ stage: 'merging_notes', percent: 50, message: typeof t === 'function' ? t('sync.reconcileMergingNotes') : 'Reconciling note differences…' });
    }

    // 2. Reconcile notes
    const localNotesList = Array.from(localNoteMap.values());
    for (const lNote of localNotesList) {
      const id = lNote.id;
      const remoteNote = await window.FirebaseSyncService.getNote(id);
      const localHtml = await getLocalNoteContent(lNote);
      let parsed = {};
      if (localHtml && typeof parseNoteHTML === 'function') {
        try { parsed = parseNoteHTML(localHtml); } catch (e) {}
      }
      const title = parsed.title || lNote.title || id;

      if (!remoteNote) {
        // Note only exists locally -> upload to cloud vault
        await window.FirebaseSyncService.queueSyncNote({
          id,
          title,
          contentHtml: localHtml,
          date: lNote.date || parsed.date || new Date().toISOString().slice(0, 10),
          tags: lNote.tags || parsed.tags || [],
          workstream: lNote.workstream || parsed.workstream || '',
          updatedAt: lNote.updatedAt || Date.now()
        }, 0);
      } else {
        // Note exists on both sides
        const remoteHtml = remoteNote.contentHtml || remoteNote.html || '';
        if (localHtml.trim() !== remoteHtml.trim()) {
          if (isLocalPriority) {
            // Local wins: save remote as history snapshot and push local
            try {
              await this.saveSnapshot(lNote.path || `notes/${id}.html`, remoteHtml, 'remote_conflict_backup');
            } catch (e) {}
            await window.FirebaseSyncService.queueSyncNote({
              id,
              title,
              contentHtml: localHtml,
              date: lNote.date || parsed.date || remoteNote.date || new Date().toISOString().slice(0, 10),
              tags: lNote.tags || parsed.tags || remoteNote.tags || [],
              workstream: lNote.workstream || parsed.workstream || remoteNote.workstream || '',
              updatedAt: Date.now()
            }, 0);
          } else {
            // Remote wins: save local as history snapshot and keep remote
            try {
              await this.saveSnapshot(lNote.path || `notes/${id}.html`, localHtml, 'local_conflict_backup');
            } catch (e) {}
          }
        }
      }
    }

    if (typeof onProgress === 'function') {
      onProgress({ stage: 'merging_stores', percent: 75, message: typeof t === 'function' ? t('sync.reconcileMergingStores') : 'Merging planner, todos, and contacts…' });
    }

    // 3. Reconcile Planner Events
    try {
      const localPlanner = await this._readJSON('planner.json', null);
      const remotePlanner = await window.FirebaseSyncService.getDoc('planner', 'events');
      const localEvents = Array.isArray(localPlanner?.events) ? localPlanner.events : [];
      const remoteEvents = Array.isArray(remotePlanner?.events) ? remotePlanner.events : [];

      const eventMap = new Map();
      if (isLocalPriority) {
        remoteEvents.forEach(e => { if (e && e.id) eventMap.set(e.id, e); });
        localEvents.forEach(e => { if (e && e.id) eventMap.set(e.id, e); });
      } else {
        localEvents.forEach(e => { if (e && e.id) eventMap.set(e.id, e); });
        remoteEvents.forEach(e => { if (e && e.id) eventMap.set(e.id, e); });
      }
      if (eventMap.size > 0) {
        await window.FirebaseSyncService.putDoc('planner', 'events', {
          version: 1,
          events: Array.from(eventMap.values())
        });
      }
    } catch (e) {
      console.warn('Planner reconciliation warning:', e);
    }

    // 4. Reconcile Todos
    try {
      let localTodos = await this._readJSON('todos/manifest.json', null);
      if (!localTodos && typeof window !== 'undefined' && Array.isArray(window.todosManifest) && window.todosManifest.length > 0) {
        localTodos = window.todosManifest;
      }
      const remoteTodos = await window.FirebaseSyncService.getDoc('todos', 'manifest');
      const lTodos = Array.isArray(localTodos) ? localTodos : [];
      const rTodos = Array.isArray(remoteTodos) ? remoteTodos : [];

      const todoMap = new Map();
      if (isLocalPriority) {
        rTodos.forEach(t => { if (t && (t.id || t.text)) todoMap.set(t.id || t.text, t); });
        lTodos.forEach(t => { if (t && (t.id || t.text)) todoMap.set(t.id || t.text, t); });
      } else {
        lTodos.forEach(t => { if (t && (t.id || t.text)) todoMap.set(t.id || t.text, t); });
        rTodos.forEach(t => { if (t && (t.id || t.text)) todoMap.set(t.id || t.text, t); });
      }
      if (todoMap.size > 0) {
        await window.FirebaseSyncService.putDoc('todos', 'manifest', Array.from(todoMap.values()));
      }
    } catch (e) {
      console.warn('Todos reconciliation warning:', e);
    }

    // 5. Reconcile Colleagues
    try {
      const localColleagues = await this._readJSON('colleagues.json', null);
      const remoteColleagues = await window.FirebaseSyncService.getDoc('colleagues', 'database');
      const lColls = Array.isArray(localColleagues?.colleagues) ? localColleagues.colleagues : (Array.isArray(localColleagues) ? localColleagues : []);
      const rColls = Array.isArray(remoteColleagues?.colleagues) ? remoteColleagues.colleagues : (Array.isArray(remoteColleagues) ? remoteColleagues : []);

      const collMap = new Map();
      if (isLocalPriority) {
        rColls.forEach(c => { if (c && (c.id || c.name)) collMap.set(c.id || c.name, c); });
        lColls.forEach(c => { if (c && (c.id || c.name)) collMap.set(c.id || c.name, c); });
      } else {
        lColls.forEach(c => { if (c && (c.id || c.name)) collMap.set(c.id || c.name, c); });
        rColls.forEach(c => { if (c && (c.id || c.name)) collMap.set(c.id || c.name, c); });
      }
      if (collMap.size > 0) {
        await window.FirebaseSyncService.putDoc('colleagues', 'database', {
          colleagues: Array.from(collMap.values())
        });
      }
    } catch (e) {
      console.warn('Colleagues reconciliation warning:', e);
    }

    // 6. Flush pending queue to cloud
    try {
      await window.FirebaseSyncService.flushQueue();
    } catch (e) {}

    // 7. Archive local files safely to backup folder
    if (typeof onProgress === 'function') {
      onProgress({ stage: 'archiving', percent: 90, message: typeof t === 'function' ? t('sync.migrationProgressArchiving') : 'Archiving local files to backup folder…' });
    }
    const archiveInfo = await this._archiveLocalFilesAfterMigration(backupDir, { notes: localNotesList });

    this.setStorageEngine('firebase');
    if (typeof settings !== 'undefined' && settings) {
      settings.storageEngine = 'firebase';
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
    }

    if (typeof onProgress === 'function') {
      onProgress({ stage: 'finalizing', percent: 100, message: typeof t === 'function' ? t('sync.migrationProgressFinalizing') : 'Smart Merge complete!' });
    }

    return {
      success: true,
      strategy,
      archive: archiveInfo
    };
  },

  async reconcileMigrationBackup(config = {}, onProgress = null) {
    if (typeof window === 'undefined' || !window.FirebaseSyncService) {
      return { skipped: true, reason: 'FirebaseSyncService unavailable' };
    }

    if (!window.FirebaseSyncService.state.isUnlocked) {
      if (config.passphrase) {
        await window.FirebaseSyncService.unlockVault(config.passphrase);
      } else {
        return { skipped: true, reason: 'Vault locked' };
      }
    }

    const backupDir = config.backupDir || '_migrated_to_cloud_backup';
    const force = config.force === true;

    // Check if backup directory exists
    let hasBackupDir = false;
    try {
      hasBackupDir = (typeof fileExists === 'function' && (await fileExists(`${backupDir}/README.txt`) || await fileExists(`${backupDir}/notes/manifest.json`) || await fileExists(`${backupDir}/planner.json`))) || false;
      if (!hasBackupDir) {
        const backupNotes = await this.listNoteFiles(`${backupDir}/notes`);
        if (Array.isArray(backupNotes) && backupNotes.length > 0) hasBackupDir = true;
      }
    } catch (e) {}

    const prevStatus = await window.FirebaseSyncService.getDoc('migration', 'reconciliation_v2_status');
    if (prevStatus && prevStatus.completed && !force) {
      return { skipped: true, reason: 'Already reconciled' };
    }

    if (!hasBackupDir && !force) {
      return { skipped: true, reason: 'No backup folder found' };
    }

    if (typeof onProgress === 'function') {
      onProgress({ stage: 'scanning', percent: 10, message: 'Scanning migration backup for notes and documents…' });
    }

    // 1. Collect notes from backup, manifests, and disk
    const manifestFromDisk = await this._readJSON('notes/manifest.json', []);
    const manifestFromBackup = await this._readJSON(`${backupDir}/notes/manifest.json`, []);
    const mbFromDisk = await this._readJSON('notes/metadata-buffer.json', { items: [] });
    const mbFromBackup = await this._readJSON(`${backupDir}/notes/metadata-buffer.json`, { items: [] });
    const inMemoryManifest = (typeof window !== 'undefined' && Array.isArray(window.manifest)) ? window.manifest : [];

    const noteMap = new Map();
    for (const item of [
      ...manifestFromDisk,
      ...manifestFromBackup,
      ...(Array.isArray(mbFromDisk?.items) ? mbFromDisk.items : []),
      ...(Array.isArray(mbFromBackup?.items) ? mbFromBackup.items : []),
      ...inMemoryManifest
    ]) {
      if (!item) continue;
      const rawId = item.id || (item.path ? item.path.replace(/^notes\//i, '').replace(/\.html$/i, '') : null);
      if (rawId && !noteMap.has(rawId)) {
        noteMap.set(rawId, { ...item, id: rawId, path: item.path || `notes/${rawId}.html` });
      }
    }

    try {
      const localFiles = await this.listNoteFiles('notes');
      for (const f of localFiles) {
        const id = f.replace(/^notes\//i, '').replace(/\.html$/i, '');
        if (!noteMap.has(id)) noteMap.set(id, { id, path: f, title: '' });
      }
    } catch (e) {}

    try {
      const backupFiles = await this.listNoteFiles(`${backupDir}/notes`);
      for (const f of backupFiles) {
        const id = f.replace(new RegExp(`^${backupDir}/notes/`, 'i'), '').replace(/\.html$/i, '');
        if (!noteMap.has(id)) noteMap.set(id, { id, path: `notes/${id}.html`, title: '', _fromBackup: true });
      }
    } catch (e) {}

    const tryReadBackupHtml = async (pathOrId, item = {}) => {
      const raw = String(pathOrId || item.path || (item.id ? `notes/${item.id}.html` : '')).replace(/\\/g, '/');
      if (!raw) return '';
      const cleanRel = raw.replace(/^notes\//i, '');
      const cleanId = cleanRel.replace(/\.html$/i, '');

      const candidates = [
        `${backupDir}/${raw}`,
        `${backupDir}/notes/${cleanRel}`,
        `${backupDir}/notes/${cleanId}.html`,
        `_migrated_to_cloud_backup/notes/${cleanId}.html`,
        `_migrated_to_cloud_backup/${cleanRel}`,
        raw,
        raw.startsWith('notes/') ? cleanRel : `notes/${raw}`,
        `notes/${cleanId}.html`,
        `${cleanId}.html`
      ];

      const seen = new Set();
      for (const cand of candidates) {
        if (!cand || seen.has(cand)) continue;
        seen.add(cand);
        try {
          const text = await readFile(cand);
          if (text && typeof text === 'string' && text.trim()) {
            return text;
          }
        } catch (e) {}
      }
      return '';
    };

    let restoredCount = 0;
    let mergedCount = 0;
    const notesToSync = [];
    const isDummy = (t, id) => !t || t === id || t === 'Untitled' || t === 'Untitled Note' || /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(t) || /^note[-_]/.test(t);

    const candidates = Array.from(noteMap.values());
    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      if (typeof onProgress === 'function' && (i % 3 === 0 || i === candidates.length - 1)) {
        onProgress({ stage: 'reconciling_notes', done: i + 1, total: candidates.length, message: `Reconciling notes (${i + 1}/${candidates.length})` });
      }
      const cleanId = window.FirebaseSyncService._normalizeId(item.id || item.path);
      const vaultNote = await window.FirebaseSyncService.getNote(cleanId);
      const vaultHtml = vaultNote ? (vaultNote.contentHtml || vaultNote.html || '') : '';
      const backupHtml = await tryReadBackupHtml(item.path, item);

      if (!backupHtml || !backupHtml.trim()) {
        continue;
      }

      if (!vaultHtml || !vaultHtml.trim()) {
        // Missing in vault or has blank body: restore from backup!
        const parsed = (typeof parseNoteHTML === 'function') ? parseNoteHTML(backupHtml) : {};
        const parsedTitle = (!isDummy(parsed.title, cleanId) ? parsed.title : '');
        const itemTitle = (!isDummy(item.title, cleanId) ? item.title : '');
        const title = parsedTitle || itemTitle || item.title || cleanId;
        notesToSync.push({
          ...item,
          id: cleanId,
          path: item.path || `notes/${cleanId}.html`,
          title,
          date: item.date || parsed.date || new Date().toISOString().slice(0, 10),
          tags: (item.tags && item.tags.length) ? item.tags : (parsed.tags || []),
          workstream: item.workstream || parsed.workstream || '',
          contentHtml: backupHtml
        });
        restoredCount++;
      } else {
        // Both vault and backup have content: check if merging is needed
        const mergedHtml = this.mergeNoteContents(backupHtml, vaultHtml);
        if (mergedHtml !== vaultHtml) {
          const parsed = (typeof parseNoteHTML === 'function') ? parseNoteHTML(mergedHtml) : {};
          const parsedTitle = (!isDummy(parsed.title, cleanId) ? parsed.title : '');
          const itemTitle = (!isDummy(item.title, cleanId) ? item.title : '');
          const title = parsedTitle || itemTitle || cleanId;
          notesToSync.push({
            ...item,
            id: cleanId,
            path: item.path || `notes/${cleanId}.html`,
            title,
            date: parsed.date || item.date || new Date().toISOString().slice(0, 10),
            tags: parsed.tags || item.tags || [],
            workstream: parsed.workstream || item.workstream || '',
            contentHtml: mergedHtml
          });
          mergedCount++;
        }
      }
    }

    if (notesToSync.length > 0) {
      if (typeof window.FirebaseSyncService.reconcileNotes === 'function') {
        await window.FirebaseSyncService.reconcileNotes(notesToSync, onProgress);
      } else {
        await window.FirebaseSyncService.fillGaps(notesToSync, onProgress);
      }
    }

    // 2. Review and reconcile other stores from backup
    try {
      const existingTodos = await window.FirebaseSyncService.getDoc('todos', 'manifest');
      if (!existingTodos || (Array.isArray(existingTodos) && existingTodos.length === 0)) {
        const backupTodos = await this._readJSON(`${backupDir}/todos/manifest.json`, null) || await this._readJSON('todos/manifest.json', null);
        if (backupTodos) {
          await window.FirebaseSyncService.putDoc('todos', 'manifest', backupTodos);
        }
      }
    } catch (e) {}

    try {
      const existingPlanner = await window.FirebaseSyncService.getDoc('planner', 'events');
      if (!existingPlanner || (Array.isArray(existingPlanner) && existingPlanner.length === 0)) {
        const backupPlanner = await this._readJSON(`${backupDir}/planner.json`, null) || await this._readJSON('planner.json', null);
        if (backupPlanner) {
          await window.FirebaseSyncService.putDoc('planner', 'events', backupPlanner);
        }
      }
    } catch (e) {}

    try {
      const existingColleagues = await window.FirebaseSyncService.getDoc('colleagues', 'database');
      if (!existingColleagues || (Array.isArray(existingColleagues) && existingColleagues.length === 0)) {
        const backupColleagues = await this._readJSON(`${backupDir}/colleagues.json`, null) || await this._readJSON('colleagues.json', null);
        if (backupColleagues) {
          await window.FirebaseSyncService.putDoc('colleagues', 'database', backupColleagues);
        }
      }
    } catch (e) {}

    try {
      const existingTopicIdx = await window.FirebaseSyncService.getDoc('topic_memories', 'index');
      if (!existingTopicIdx || (Array.isArray(existingTopicIdx.topics) && existingTopicIdx.topics.length === 0)) {
        const backupTopicIdx = await this._readJSON(`${backupDir}/raw/topic-memories/index.json`, null) || await this._readJSON('raw/topic-memories/index.json', null);
        if (backupTopicIdx) {
          await window.FirebaseSyncService.putDoc('topic_memories', 'index', backupTopicIdx);
          if (Array.isArray(backupTopicIdx.topics)) {
            for (const top of backupTopicIdx.topics) {
              const k = top.key || top.topicName;
              if (k) {
                const mem = await this._readJSON(`${backupDir}/raw/topic-memories/${k}.json`, null) || await this._readJSON(`raw/topic-memories/${k}.json`, null);
                if (mem) {
                  await window.FirebaseSyncService.putDoc('topic_memories', k, mem);
                }
              }
            }
          }
        }
      }
    } catch (e) {}

    // Reconcile and recover image assets
    const assetFolders = [`${backupDir}/notes/_assets`, `${backupDir}/_assets`, 'notes/_assets', '_assets'];
    for (const folder of assetFolders) {
      try {
        const aFiles = await this.listAssetFiles(folder);
        for (const aPath of (Array.isArray(aFiles) ? aFiles : [])) {
          const fileName = aPath.split('/').pop();
          if (!fileName) continue;
          try {
            const existingAsset = await window.FirebaseSyncService.getAsset(fileName);
            if (!existingAsset) {
              const dataUrl = (typeof readAssetAsDataUrl === 'function' ? await readAssetAsDataUrl(aPath) : null)
                || (window.AppBridge?.fs?.readAsset ? await window.AppBridge.fs.readAsset(aPath) : null)
                || (window.AppBridge?.fs?.readAsset ? await window.AppBridge.fs.readAsset(fileName) : null);
              if (dataUrl) {
                await window.FirebaseSyncService.saveAsset(fileName, dataUrl, {}, 0);
                await window.FirebaseSyncService.saveAsset(`notes/_assets/${fileName}`, dataUrl, {}, 0);
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    // Run repair of any legacy dummy manifest titles in vault
    if (typeof window.FirebaseSyncService.repairManifestTitles === 'function') {
      try {
        await window.FirebaseSyncService.repairManifestTitles();
      } catch (e) {}
    }

    // 3. Move any remaining non-backup local files to backup folder
    await this._archiveLocalFilesAfterMigration(backupDir, {
      notes: notesToSync
    });

    // 4. Rebuild in-memory manifest & search index
    if (typeof window !== 'undefined') {
      const allVaultManifest = window.FirebaseSyncService.getManifest();
      if (Array.isArray(allVaultManifest) && allVaultManifest.length > 0) {
        window.manifest = allVaultManifest;
        if (typeof buildSearchIndex === 'function') {
          buildSearchIndex(allVaultManifest);
        }
      }
    }

    // 5. Mark reconciliation status in vault
    await window.FirebaseSyncService.putDoc('migration', 'reconciliation_v2_status', {
      completed: true,
      completedAt: Date.now(),
      restoredCount,
      mergedCount,
      version: 2
    });

    return {
      success: true,
      restoredCount,
      mergedCount,
      restoredNotesCount: restoredCount,
      mergedNotesCount: mergedCount,
      totalReconciled: notesToSync.length
    };
  },

  async fillMigrationGaps(passphrase, config = {}, onProgress = null) {
    return await this.reconcileMigrationBackup({ ...config, passphrase, force: true }, onProgress);
  },

  async _archiveLocalFilesAfterMigration(backupDir = '_migrated_to_cloud_backup', data = {}) {
    const movedFiles = [];

    const moveFile = async (relPath) => {
      if (!relPath || relPath === 'planner-proposals.json' || relPath.startsWith('.settings') || relPath.startsWith(backupDir)) {
        return;
      }
      try {
        if (await fileExists(relPath)) {
          const content = await readFile(relPath);
          await writeFile(`${backupDir}/${relPath}`, content);
          await deleteFile(relPath);
          movedFiles.push(relPath);
        }
      } catch (err) {
        console.warn(`Failed to archive file ${relPath}:`, err);
      }
    };

    // 1. Move notes
    if (Array.isArray(data.notes)) {
      for (const n of data.notes) {
        if (n?.path) await moveFile(n.path);
      }
    }
    await moveFile('notes/manifest.json');
    await moveFile('notes/manifest.js');
    await moveFile('notes/metadata-buffer.json');
    await moveFile('notes/metadata-shards-index.json');
    try {
      const localFiles = await this.listNoteFiles('notes');
      for (const f of (localFiles || [])) {
        await moveFile(f);
      }
    } catch (e) {}

    // 2. Move todos
    await moveFile('todos/manifest.json');
    await moveFile('todos/_order.json');
    await moveFile('todos/index.html');
    for (const prio of ['p1', 'p2', 'p3', 'p4']) {
      try {
        const mdFiles = await this.listLegacyTodoMdFiles(prio);
        for (const f of mdFiles) {
          await moveFile(`todos/${prio}/${f}`);
        }
      } catch (e) {}
    }

    // 3. Move planner & colleagues
    await moveFile('planner.json');
    await moveFile('colleagues.json');

    // 4. Move topic memories
    await moveFile('raw/topic-memories/index.json');
    if (Array.isArray(data.topicMemories)) {
      for (const tm of data.topicMemories) {
        if (tm?.key) await moveFile(`raw/topic-memories/${tm.key}.json`);
      }
    }

    // 5. Move .secretary metadata
    await moveFile('.secretary/chat-history.json');
    await moveFile('.secretary/colleagues-migration-v1.done');

    // 6. Move .trash
    if (Array.isArray(data.trashNotes)) {
      for (const tn of data.trashNotes) {
        if (tn?.filename) await moveFile(`.trash/${tn.filename}`);
      }
    }
    await moveFile('.trash/manifest.json');

    // 7. Move stash
    if (Array.isArray(data.stashFiles)) {
      for (const sf of data.stashFiles) {
        if (sf?.name) await moveFile(`stash/${sf.name}`);
      }
    }

    // 8. Move asset files
    try {
      const assets = await this.listAssetFiles('notes/_assets');
      for (const a of (assets || [])) {
        await moveFile(a);
      }
      const rootAssets = await this.listAssetFiles('_assets');
      for (const a of (rootAssets || [])) {
        await moveFile(a);
      }
    } catch (e) {}

    // 9. Write informational README into the backup folder
    try {
      const readmeContent = [
        'Secretary - Cloud Migration Backup',
        '==================================',
        '',
        'These local files were automatically moved to this folder during your migration',
        'to the encrypted Firebase vault.',
        '',
        'All your notes, todos, planner events, colleagues, chat history, trash, and',
        'stash files are now securely end-to-end encrypted in your cloud vault.',
        '',
        'You can safely delete this entire folder once you have verified your data.'
      ].join('\n');
      await writeFile(`${backupDir}/README.txt`, readmeContent);
    } catch (e) {}

    return { backupDir, movedFiles, movedCount: movedFiles.length };
  },

  async revertToFilesystem() {
    if (typeof window === 'undefined' || !window.FirebaseSyncService) {
      throw new Error('FirebaseSyncService is not available');
    }

    const exported = await window.FirebaseSyncService.exportToFilesystem();
    const { manifest = [], notes = [], todosManifest, todosOrder, planner, colleagues, colleaguesMigration, chatHistory, trashManifest, trashNotes, stashFiles, topicMemories, assets, settings: exportedSettings } = (exported || {});

    // Write all notes to filesystem files
    for (const note of notes) {
      if (!note || !note.path) continue;
      try {
        await writeFile(note.path, note.contentHtml || note.html || '');
      } catch (e) {}
    }

    // Write notes manifest
    await this._writeJSON('notes/manifest.json', manifest);

    // Write todos manifest & order
    if (todosManifest) {
      await this._writeJSON('todos/manifest.json', todosManifest);
    }
    if (todosOrder) {
      await this._writeJSON('todos/_order.json', todosOrder);
    }

    // Write planner
    if (planner) {
      await this._writeJSON('planner.json', planner);
    }

    // Write colleagues
    if (colleagues) {
      await this._writeJSON('colleagues.json', colleagues);
    }

    // Write colleagues migration
    if (colleaguesMigration) {
      await this._writeJSON('.secretary/colleagues-migration-v1.done', colleaguesMigration);
    }

    // Write topic memories
    if (topicMemories?.index) {
      await this._writeJSON('raw/topic-memories/index.json', topicMemories.index);
    }
    if (Array.isArray(topicMemories?.memories)) {
      for (const tm of topicMemories.memories) {
        if (tm?.key && tm?.data) {
          await this._writeJSON(`raw/topic-memories/${tm.key}.json`, tm.data);
        }
      }
    }

    // Write chat history
    if (chatHistory) {
      await this._writeJSON('.secretary/chat-history.json', chatHistory);
    }

    // Write trash
    if (trashManifest) {
      await this._writeJSON('.trash/manifest.json', trashManifest);
    }
    if (Array.isArray(trashNotes)) {
      for (const tn of trashNotes) {
        if (tn && tn.filename && tn.content !== undefined) {
          try {
            await writeFile(`.trash/${tn.filename}`, tn.content);
          } catch (e) {}
        }
      }
    }

    // Write stash files
    if (Array.isArray(stashFiles)) {
      for (const sf of stashFiles) {
        if (sf && sf.name && sf.content !== undefined) {
          try {
            await writeFile(`stash/${sf.name}`, sf.content);
          } catch (e) {}
        }
      }
    }

    // Write settings
    if (exportedSettings && typeof exportedSettings === 'object') {
      const existingSettings = (await this._readJSON('secretary-settings.json', null)) || {};
      const mergedSettings = {
        ...exportedSettings,
        ...existingSettings,
        storageEngine: 'filesystem',
        ui: { ...(exportedSettings.ui || {}), ...(existingSettings.ui || {}) },
        ai: { ...(exportedSettings.ai || {}), ...(existingSettings.ai || {}) }
      };
      await this._writeJSON('secretary-settings.json', mergedSettings);
    }

    this.setStorageEngine('filesystem');
    if (typeof settings !== 'undefined' && settings) {
      settings.storageEngine = 'filesystem';
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
    }

    return { manifestCount: manifest.length, notesCount: notes.length };
  }
};

window.StorageAPI = StorageAPI;

