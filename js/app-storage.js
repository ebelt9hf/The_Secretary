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
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      const doc = await window.FirebaseSyncService.getDoc(docKind, docId);
      return doc !== null && doc !== undefined ? doc : fallback;
    }
    return await this._readJSON(localFile, fallback);
  },

  async writeDocEntity(docKind, docId, localFile, payload) {
    if (this.getStorageEngine() !== 'firebase') {
      try {
        await this._writeJSON(localFile, payload);
      } catch (_e) {}
    }
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
      await window.FirebaseSyncService.putDoc(docKind, docId, payload);
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
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.saveAsset) {
      await window.FirebaseSyncService.saveAsset(relPath, fullDataUrl);
    }
    await writeFile(relPath, fullDataUrl);
    this.emit('storage:change', { entity: 'assets', id: relPath, action: 'save' });
  },

  async readAsset(relPath) {
    if (this.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.getAsset) {
      const fileName = relPath.split('/').pop();
      const asset = await window.FirebaseSyncService.getAsset(fileName) || await window.FirebaseSyncService.getAsset(relPath);
      if (asset) return asset;
    }
    if (typeof readAssetAsDataUrl === 'function') {
      return await readAssetAsDataUrl(relPath);
    }
    if (window.AppBridge?.fs?.readAsset) {
      return await window.AppBridge.fs.readAsset(relPath);
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

  async revertToFilesystem() {
    return await this._getMigrator().revertToFilesystem();
  }
};

window.StorageAPI = StorageAPI;

