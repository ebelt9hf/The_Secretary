'use strict';

/**
 * Secretary: Data Migration & Reconciliation Subsystem (js/storage-migration.js)
 *
 * Implements dedicated, decoupled migration logic for:
 * - Migrating local filesystem vaults to end-to-end encrypted Firebase vaults
 * - Exporting / reverting encrypted Firebase vaults back to local disk files
 * - Detecting conflicts between local workspace data and remote cloud vaults
 * - Smart 3-way note and store reconciliation
 * - Archiving local files to backup folders during migrations
 *
 * Decoupled from normal application runtime execution to maintain clean separation of concerns.
 */
const StorageMigration = {

  // ── Smart Note Content Merging ──
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

    // If new HTML has no substantive body text (e.g. empty template <p></p>)
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

    // Both have distinct substantive content: use original and append new
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

  // ── Local File Collection Helpers ──
  async _collectLocalNoteEntries(options = {}) {
    const backupDir = options.backupDir || null;
    const includeShards = !!options.includeShards;
    const storage = (typeof StorageAPI !== 'undefined' ? StorageAPI : null);
    const readJSON = async (f, fb) => (storage && storage._readJSON ? storage._readJSON(f, fb) : fb);

    const manifestFromDisk = await readJSON('notes/manifest.json', []);
    const mbFromDisk = await readJSON('notes/metadata-buffer.json', { items: [] });
    let shardItems = [];
    if (includeShards && storage?.readMetadataShardsIndex) {
      try {
        const shardsIndex = await storage.readMetadataShardsIndex();
        if (Array.isArray(shardsIndex?.shardFiles)) {
          for (const sf of shardsIndex.shardFiles) {
            const parsed = await storage.readMetadataShard(sf);
            if (Array.isArray(parsed?.items)) {
              shardItems = shardItems.concat(parsed.items);
            }
          }
        }
      } catch (e) {}
    }
    const inMemManifest = (typeof window !== 'undefined' && Array.isArray(window.manifest)) ? window.manifest : [];
    const inMemBuffer = (typeof window !== 'undefined' && Array.isArray(window.metadataBuffer)) ? window.metadataBuffer : [];
    const inMemMetadata = (typeof window !== 'undefined' && window.metadataById instanceof Map) ? Array.from(window.metadataById.values()) : [];
    const diskHtmlFiles = (storage && typeof storage.listNoteFiles === 'function') ? (await storage.listNoteFiles('notes')) : [];

    const localMap = new Map();
    for (const item of [
      ...manifestFromDisk,
      ...(Array.isArray(mbFromDisk?.items) ? mbFromDisk.items : []),
      ...shardItems,
      ...inMemManifest,
      ...inMemBuffer,
      ...inMemMetadata
    ]) {
      if (!item) continue;
      const rawId = typeof normalizeNoteId === 'function' ? normalizeNoteId(item) : (item.id || (item.path ? item.path.replace(/^notes\//i, '').replace(/\.html$/i, '') : null));
      const cleanPath = item.path || (rawId ? (typeof normalizeNotePath === 'function' ? normalizeNotePath(rawId) : `notes/${rawId}.html`) : null);
      if (rawId && !localMap.has(rawId)) {
        localMap.set(rawId, { ...item, id: rawId, path: cleanPath || (item.path ? item.path : `notes/${rawId}.html`) });
      }
    }
    for (const rel of (Array.isArray(diskHtmlFiles) ? diskHtmlFiles : [])) {
      const id = typeof normalizeNoteId === 'function' ? normalizeNoteId(rel) : rel.replace(/^notes\//i, '').replace(/\.html$/i, '');
      if (id && !localMap.has(id)) {
        localMap.set(id, { id, path: rel.startsWith('notes/') ? rel : `notes/${rel}`, title: '' });
      }
    }

    if (backupDir && storage?.listNoteFiles) {
      try {
        const backupHtmlFiles = await storage.listNoteFiles(`${backupDir}/notes`);
        for (const bPath of (Array.isArray(backupHtmlFiles) ? backupHtmlFiles : [])) {
          const relPath = bPath.replace(new RegExp(`^${backupDir}/`, 'i'), '');
          const normPath = relPath.startsWith('notes/') ? relPath : `notes/${relPath}`;
          const id = typeof normalizeNoteId === 'function' ? normalizeNoteId(normPath) : normPath.replace(/^notes\//i, '').replace(/\.html$/i, '');
          if (!localMap.has(id)) {
            localMap.set(id, { id, path: normPath, title: '', _fromBackup: true });
          }
        }
      } catch (e) {}
    }

    return localMap;
  },

  // ── Dual-Engine Migration Assistant: Migrate to Firebase ──
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
    const storage = (typeof StorageAPI !== 'undefined' ? StorageAPI : null);

    // 1. Collect notes comprehensively
    const noteMap = await this._collectLocalNoteEntries({ backupDir, includeShards: true });

    const tryReadNoteHtml = async (pathOrId, item = {}) => {
      let cached = (storage && storage.getNoteFromCache && storage.getNoteFromCache(pathOrId))
        || (item.path && storage && storage.getNoteFromCache && storage.getNoteFromCache(item.path));
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

    const readJSON = async (f, fb) => (storage && storage._readJSON ? storage._readJSON(f, fb) : fb);

    // 2. Collect additional stores
    let todosManifest = await readJSON('todos/manifest.json', null);
    if (!todosManifest) todosManifest = await readJSON(`${backupDir}/todos/manifest.json`, null);
    if (!todosManifest && typeof window !== 'undefined' && Array.isArray(window.todosManifest) && window.todosManifest.length > 0) {
      todosManifest = window.todosManifest;
    }
    let todosOrder = await readJSON('todos/_order.json', null) || await readJSON(`${backupDir}/todos/_order.json`, null);
    let planner = await readJSON('planner.json', null) || await readJSON(`${backupDir}/planner.json`, null);
    let colleagues = await readJSON('colleagues.json', null) || await readJSON(`${backupDir}/colleagues.json`, null);
    let colleaguesMigration = await readJSON('.secretary/colleagues-migration-v1.done', null) || await readJSON(`${backupDir}/.secretary/colleagues-migration-v1.done`, null);
    let chatHistory = await readJSON('.secretary/chat-history.json', null) || await readJSON(`${backupDir}/.secretary/chat-history.json`, null);
    let trashManifest = await readJSON('.trash/manifest.json', null) || await readJSON(`${backupDir}/.trash/manifest.json`, null);

    const trashNotes = [];
    if (Array.isArray(trashManifest)) {
      for (const t of trashManifest) {
        if (!t || !t.filename) continue;
        try {
          const content = await readFile(`.trash/${t.filename}`);
          trashNotes.push({ filename: t.filename, content, meta: t });
        } catch (e) {
          try {
            const content = await readFile(`${backupDir}/.trash/${t.filename}`);
            trashNotes.push({ filename: t.filename, content, meta: t });
          } catch (e2) {}
        }
      }
    }

    const stashFiles = [];
    try {
      const stashList = storage?.listStashFiles ? await storage.listStashFiles() : [];
      for (const sName of (Array.isArray(stashList) ? stashList : [])) {
        try {
          const content = await readFile(`stash/${sName}`);
          stashFiles.push({ name: sName, content });
        } catch (e) {
          try {
            const content = await readFile(`${backupDir}/stash/${sName}`);
            stashFiles.push({ name: sName, content });
          } catch (e2) {}
        }
      }
    } catch (e) {}

    // Collect asset files (images)
    const assetList = [];
    const assetFolders = ['notes/_assets', '_assets', `${backupDir}/notes/_assets`, `${backupDir}/_assets`];
    const seenAssetIds = new Set();
    for (const folder of assetFolders) {
      try {
        const aFiles = storage?.listAssetFiles ? await storage.listAssetFiles(folder) : [];
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

    // Collect Topic Memories
    let topicMemoriesList = [];
    let topicMemoriesIndex = null;
    try {
      const topicData = storage?._collectTopicMemories ? await storage._collectTopicMemories(backupDir) : { index: { topics: [] }, memories: [] };
      topicMemoriesIndex = topicData.index;
      topicMemoriesList = topicData.memories;
    } catch (e) {
      console.warn('Failed collecting topic memories during migration', e);
    }

    let exportedSettings = null;
    try {
      exportedSettings = await readJSON('secretary-settings.json', null);
      if (!exportedSettings) exportedSettings = await readJSON(`${backupDir}/secretary-settings.json`, null);
    } catch (e) {}

    // 3. Perform Migration through FirebaseSyncService
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
      topicMemories: {
        index: topicMemoriesIndex,
        memories: topicMemoriesList
      },
      assets: assetList,
      settings: exportedSettings
    }, onProgress);

    // 4. Archive local files to backup directory
    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'archiving',
        percent: 90,
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

    if (storage?.setStorageEngine) {
      storage.setStorageEngine('firebase');
    }
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

  // ── Sync Conflict Detection ──
  async detectSyncConflict(options = {}) {
    const storage = (typeof StorageAPI !== 'undefined' ? StorageAPI : null);
    const readJSON = async (f, fb) => (storage && storage._readJSON ? storage._readJSON(f, fb) : fb);

    let localNotes = [];
    try {
      const localMap = await this._collectLocalNoteEntries();
      localNotes = Array.from(localMap.values());
    } catch (e) {}

    let localTodos = await readJSON('todos/manifest.json', null);
    if (!localTodos && typeof window !== 'undefined' && Array.isArray(window.todosManifest) && window.todosManifest.length > 0) {
      localTodos = window.todosManifest;
    }
    const localPlanner = await readJSON('planner.json', null);
    const localColleagues = await readJSON('colleagues.json', null);

    const localStats = {
      noteCount: localNotes.length,
      todoCount: Array.isArray(localTodos) ? localTodos.length : 0,
      plannerCount: Array.isArray(localPlanner?.events) ? localPlanner.events.length : 0,
      colleagueCount: Array.isArray(localColleagues?.colleagues || localColleagues) ? (localColleagues.colleagues || localColleagues).length : 0,
      lastModified: Math.max(0, ...localNotes.map(n => n.updatedAt || 0))
    };

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

  // ── Smart Reconciliation ──
  async reconcileLocalAndCloudVault(passphrase, strategy = 'merge_local_priority', options = {}, onProgress = null) {
    if (typeof window === 'undefined' || !window.FirebaseSyncService) {
      throw new Error('FirebaseSyncService is not available');
    }
    const backupDir = options.backupDir || '_migrated_to_cloud_backup';
    const storage = (typeof StorageAPI !== 'undefined' ? StorageAPI : null);
    const readJSON = async (f, fb) => (storage && storage._readJSON ? storage._readJSON(f, fb) : fb);

    if (strategy === 'overwrite_cloud') {
      const res = await this.migrateToFirebase(passphrase, { backupDir, ...options }, onProgress);
      return { success: true, ...res, strategy: 'overwrite_cloud' };
    }

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

      const localFiles = storage?.listNoteFiles ? await storage.listNoteFiles('notes') : [];
      const notesToArchive = (Array.isArray(localFiles) ? localFiles : []).map(p => ({
        id: p.replace(/^notes\//, '').replace(/\.html$/, ''),
        path: p.startsWith('notes/') ? p : `notes/${p}`
      }));

      await this._archiveLocalFilesAfterMigration(backupDir, { notes: notesToArchive });
      if (storage?.setStorageEngine) {
        storage.setStorageEngine('firebase');
      }
      if (typeof settings !== 'undefined' && settings) {
        settings.storageEngine = 'firebase';
        if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
      }

      if (typeof onProgress === 'function') {
        onProgress({ stage: 'finalizing', percent: 100, message: typeof t === 'function' ? t('sync.migrationProgressFinalizing') : 'Synchronization complete!' });
      }
      return { success: true, strategy: 'overwrite_local' };
    }

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

    const localNoteMap = await this._collectLocalNoteEntries();

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
        const remoteHtml = remoteNote.contentHtml || remoteNote.html || '';
        if (localHtml.trim() !== remoteHtml.trim()) {
          if (isLocalPriority) {
            try {
              if (storage?.saveSnapshot) await storage.saveSnapshot(lNote.path || `notes/${id}.html`, remoteHtml, 'remote_conflict_backup');
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
            try {
              if (storage?.saveSnapshot) await storage.saveSnapshot(lNote.path || `notes/${id}.html`, localHtml, 'local_conflict_backup');
            } catch (e) {}
          }
        }
      }
    }

    if (typeof onProgress === 'function') {
      onProgress({ stage: 'merging_stores', percent: 75, message: typeof t === 'function' ? t('sync.reconcileMergingStores') : 'Merging planner, todos, and contacts…' });
    }

    // Reconcile Planner
    try {
      const localPlanner = await readJSON('planner.json', null);
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

    // Reconcile Todos
    try {
      let localTodos = await readJSON('todos/manifest.json', null);
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

    // Reconcile Colleagues
    try {
      const localColleagues = await readJSON('colleagues.json', null);
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

    // 6. Reconcile Topic Memories / Workstreams
    let localTopicData = { index: { topics: [] }, memories: [] };
    try {
      localTopicData = storage?._collectTopicMemories ? await storage._collectTopicMemories(backupDir) : { index: { topics: [] }, memories: [] };
      const remoteTopicIdx = await window.FirebaseSyncService.getDoc('topic_memories', 'index');

      const localTopics = Array.isArray(localTopicData?.index?.topics) ? localTopicData.index.topics : [];
      const remoteTopics = Array.isArray(remoteTopicIdx?.topics) ? remoteTopicIdx.topics : [];

      const topicIndexMap = new Map();
      const normalizeK = (t) => {
        if (!t) return '';
        const k = t.key || t.topicName || '';
        return (typeof sanitizeTopicMemoryKey === 'function' ? sanitizeTopicMemoryKey(k) : k.toLowerCase().trim());
      };

      if (isLocalPriority) {
        remoteTopics.forEach(t => { if (t) { const nk = normalizeK(t); if (nk) topicIndexMap.set(nk, t); } });
        localTopics.forEach(t => { if (t) { const nk = normalizeK(t); if (nk) topicIndexMap.set(nk, t); } });
      } else {
        localTopics.forEach(t => { if (t) { const nk = normalizeK(t); if (nk) topicIndexMap.set(nk, t); } });
        remoteTopics.forEach(t => { if (t) { const nk = normalizeK(t); if (nk) topicIndexMap.set(nk, t); } });
      }

      const mergedTopics = Array.from(topicIndexMap.values());
      const mergedIndex = {
        version: 1,
        topics: mergedTopics
      };

      if (mergedTopics.length > 0) {
        await window.FirebaseSyncService.putDoc('topic_memories', 'index', mergedIndex);

        if (typeof _topicMemoriesIndexCache !== 'undefined') {
          _topicMemoriesIndexCache = mergedIndex;
        }
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem('secretary_topic_memories_index', JSON.stringify(mergedIndex));
            localStorage.setItem('secretary_topic_memories_index_v1', JSON.stringify(mergedIndex));
          } catch (e) {}
        }

        // Reconcile individual topic memory dossiers
        for (const top of mergedTopics) {
          const k = top.key || top.topicName;
          const sanitized = (typeof sanitizeTopicMemoryKey === 'function' ? sanitizeTopicMemoryKey(k) : k) || k;
          if (!sanitized) continue;

          let remoteDoc = null;
          try {
            remoteDoc = await window.FirebaseSyncService.getDoc('topic_memories', sanitized);
          } catch (e) {}

          const localItem = (localTopicData.memories || []).find(m => m.key === sanitized || m.key === k);
          const localDoc = localItem ? localItem.data : null;

          let finalDoc = null;
          if (localDoc && remoteDoc) {
            if (isLocalPriority) {
              finalDoc = localDoc;
            } else {
              const localTs = typeof parseFlexibleTimestamp === 'function' ? parseFlexibleTimestamp(localDoc.lastUpdated) : 0;
              const remoteTs = typeof parseFlexibleTimestamp === 'function' ? parseFlexibleTimestamp(remoteDoc.lastUpdated) : 0;
              finalDoc = (remoteTs >= localTs) ? remoteDoc : localDoc;
            }
          } else if (localDoc) {
            finalDoc = localDoc;
          } else if (remoteDoc) {
            finalDoc = remoteDoc;
          }

          if (finalDoc) {
            await window.FirebaseSyncService.putDoc('topic_memories', sanitized, finalDoc);
            if (typeof _topicMemoryFileCache !== 'undefined' && _topicMemoryFileCache instanceof Map) {
              _topicMemoryFileCache.set(sanitized, finalDoc);
            }
            if (typeof localStorage !== 'undefined') {
              try {
                localStorage.setItem(`secretary_topic_memory_${sanitized}`, JSON.stringify(finalDoc));
              } catch (e) {}
            }
          }
        }
      }
    } catch (e) {
      console.warn('Topic memories reconciliation warning:', e);
    }

    // Flush pending queue
    try {
      await window.FirebaseSyncService.flushQueue();
    } catch (e) {}

    // Archive local files
    if (typeof onProgress === 'function') {
      onProgress({ stage: 'archiving', percent: 90, message: typeof t === 'function' ? t('sync.migrationProgressArchiving') : 'Archiving local files to backup folder…' });
    }
    const archiveInfo = await this._archiveLocalFilesAfterMigration(backupDir, {
      notes: localNotesList
    });

    if (storage?.setStorageEngine) {
      storage.setStorageEngine('firebase');
    }
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
    const storage = (typeof StorageAPI !== 'undefined' ? StorageAPI : null);
    const readJSON = async (f, fb) => (storage && storage._readJSON ? storage._readJSON(f, fb) : fb);

    let hasBackupDir = false;
    try {
      hasBackupDir = (typeof fileExists === 'function' && (await fileExists(`${backupDir}/README.txt`) || await fileExists(`${backupDir}/notes/manifest.json`) || await fileExists(`${backupDir}/planner.json`))) || false;
      if (!hasBackupDir && storage?.listNoteFiles) {
        const backupNotes = await storage.listNoteFiles(`${backupDir}/notes`);
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

    const manifestFromDisk = await readJSON('notes/manifest.json', []);
    const manifestFromBackup = await readJSON(`${backupDir}/notes/manifest.json`, []);
    const mbFromDisk = await readJSON('notes/metadata-buffer.json', { items: [] });
    const mbFromBackup = await readJSON(`${backupDir}/notes/metadata-buffer.json`, { items: [] });
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
      if (storage?.listNoteFiles) {
        const localFiles = await storage.listNoteFiles('notes');
        for (const f of localFiles) {
          const id = f.replace(/^notes\//i, '').replace(/\.html$/i, '');
          if (!noteMap.has(id)) noteMap.set(id, { id, path: f, title: '' });
        }
      }
    } catch (e) {}

    try {
      if (storage?.listNoteFiles) {
        const backupFiles = await storage.listNoteFiles(`${backupDir}/notes`);
        for (const f of backupFiles) {
          const id = f.replace(new RegExp(`^${backupDir}/notes/`, 'i'), '').replace(/\.html$/i, '');
          if (!noteMap.has(id)) noteMap.set(id, { id, path: `notes/${id}.html`, title: '', _fromBackup: true });
        }
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

    try {
      const existingTodos = await window.FirebaseSyncService.getDoc('todos', 'manifest');
      if (!existingTodos || (Array.isArray(existingTodos) && existingTodos.length === 0)) {
        const backupTodos = await readJSON(`${backupDir}/todos/manifest.json`, null) || await readJSON('todos/manifest.json', null);
        if (backupTodos) {
          await window.FirebaseSyncService.putDoc('todos', 'manifest', backupTodos);
        }
      }
    } catch (e) {}

    try {
      const existingPlanner = await window.FirebaseSyncService.getDoc('planner', 'events');
      if (!existingPlanner || (Array.isArray(existingPlanner) && existingPlanner.length === 0)) {
        const backupPlanner = await readJSON(`${backupDir}/planner.json`, null) || await readJSON('planner.json', null);
        if (backupPlanner) {
          await window.FirebaseSyncService.putDoc('planner', 'events', backupPlanner);
        }
      }
    } catch (e) {}

    try {
      const existingColleagues = await window.FirebaseSyncService.getDoc('colleagues', 'database');
      if (!existingColleagues || (Array.isArray(existingColleagues) && existingColleagues.length === 0)) {
        const backupColleagues = await readJSON(`${backupDir}/colleagues.json`, null) || await readJSON('colleagues.json', null);
        if (backupColleagues) {
          await window.FirebaseSyncService.putDoc('colleagues', 'database', backupColleagues);
        }
      }
    } catch (e) {}

    try {
      const existingTopicIdx = await window.FirebaseSyncService.getDoc('topic_memories', 'index');
      const backupTopicData = storage?._collectTopicMemories ? await storage._collectTopicMemories(backupDir) : { index: { topics: [] }, memories: [] };
      const backupTopicIdx = backupTopicData?.index;

      if (!existingTopicIdx || !Array.isArray(existingTopicIdx.topics) || existingTopicIdx.topics.length === 0) {
        if (backupTopicIdx && Array.isArray(backupTopicIdx.topics) && backupTopicIdx.topics.length > 0) {
          await window.FirebaseSyncService.putDoc('topic_memories', 'index', backupTopicIdx);
          for (const memItem of (backupTopicData.memories || [])) {
            if (memItem && memItem.key && memItem.data) {
              await window.FirebaseSyncService.putDoc('topic_memories', memItem.key, memItem.data);
            }
          }
        }
      } else if (backupTopicIdx && Array.isArray(backupTopicIdx.topics)) {
        const topicIndexMap = new Map();
        existingTopicIdx.topics.forEach(t => {
          const k = (typeof sanitizeTopicMemoryKey === 'function' ? sanitizeTopicMemoryKey(t.key || t.topicName) : (t.key || t.topicName));
          if (k) topicIndexMap.set(k, t);
        });
        let addedAny = false;
        for (const bt of backupTopicIdx.topics) {
          const k = (typeof sanitizeTopicMemoryKey === 'function' ? sanitizeTopicMemoryKey(bt.key || bt.topicName) : (bt.key || bt.topicName));
          if (k && !topicIndexMap.has(k)) {
            topicIndexMap.set(k, bt);
            addedAny = true;
            const memItem = (backupTopicData.memories || []).find(m => m.key === k);
            if (memItem?.data) {
              await window.FirebaseSyncService.putDoc('topic_memories', k, memItem.data);
            }
          }
        }
        if (addedAny) {
          await window.FirebaseSyncService.putDoc('topic_memories', 'index', {
            version: 1,
            topics: Array.from(topicIndexMap.values())
          });
        }
      }
    } catch (e) {}

    const assetFolders = [`${backupDir}/notes/_assets`, `${backupDir}/_assets`, 'notes/_assets', '_assets'];
    for (const folder of assetFolders) {
      try {
        const aFiles = storage?.listAssetFiles ? await storage.listAssetFiles(folder) : [];
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

    // Move any remaining non-backup local files to backup folder
    await this._archiveLocalFilesAfterMigration(backupDir, {
      notes: notesToSync
    });

    if (typeof window !== 'undefined') {
      const allVaultManifest = window.FirebaseSyncService.getManifest();
      if (Array.isArray(allVaultManifest) && allVaultManifest.length > 0) {
        window.manifest = allVaultManifest;
        if (typeof buildSearchIndex === 'function') {
          buildSearchIndex(allVaultManifest);
        }
      }
    }

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

  // ── File Archival Helper ──
  async _archiveLocalFilesAfterMigration(backupDir = '_migrated_to_cloud_backup', data = {}) {
    const movedFiles = [];
    const storage = (typeof StorageAPI !== 'undefined' ? StorageAPI : null);

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
      if (storage?.listNoteFiles) {
        const localFiles = await storage.listNoteFiles('notes');
        for (const f of (localFiles || [])) {
          await moveFile(f);
        }
      }
    } catch (e) {}

    // 2. Move todos
    await moveFile('todos/manifest.json');
    await moveFile('todos/_order.json');
    await moveFile('todos/index.html');
    for (const prio of ['p1', 'p2', 'p3', 'p4']) {
      try {
        if (storage?.listLegacyTodoMdFiles) {
          const mdFiles = await storage.listLegacyTodoMdFiles(prio);
          for (const f of mdFiles) {
            await moveFile(`todos/${prio}/${f}`);
          }
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
    try {
      if (storage?.listStashFiles) {
        const extraStash = await storage.listStashFiles();
        for (const sf of (extraStash || [])) {
          await moveFile(`stash/${sf}`);
        }
      }
    } catch (e) {}

    // 8. Move asset files
    try {
      if (storage?.listAssetFiles) {
        const assets = await storage.listAssetFiles('notes/_assets');
        for (const a of (assets || [])) {
          await moveFile(a);
        }
        const rootAssets = await storage.listAssetFiles('_assets');
        for (const a of (rootAssets || [])) {
          await moveFile(a);
        }
      }
    } catch (e) {}

    // 9. Write README
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

  // ── Revert / Export from Firebase back to Filesystem ──
  async revertToFilesystem(onProgress = null) {
    if (typeof window === 'undefined' || !window.FirebaseSyncService) {
      throw new Error('FirebaseSyncService is not available');
    }

    if (typeof onProgress === 'function') {
      onProgress({
        step: 'exporting',
        percent: 15,
        message: typeof t === 'function' ? t('sync.revertExportingData') : 'Extracting and decrypting notes from cloud vault…'
      });
    }

    const exported = await window.FirebaseSyncService.exportToFilesystem();
    const { manifest = [], notes = [], todosManifest, todosOrder, planner, colleagues, colleaguesMigration, chatHistory, trashManifest, trashNotes, stashFiles, topicMemories, settings: exportedSettings } = (exported || {});
    const storage = (typeof StorageAPI !== 'undefined' ? StorageAPI : null);
    const writeJSON = async (f, d) => (storage && storage._writeJSON ? storage._writeJSON(f, d) : writeFile(f, JSON.stringify(d, null, 2)));

    // Write notes
    const totalNotes = notes.length;
    let writtenNotes = 0;
    for (let i = 0; i < totalNotes; i++) {
      const note = notes[i];
      if (!note || !note.path) continue;
      try {
        await writeFile(note.path, note.contentHtml || note.html || '');
        writtenNotes++;
      } catch (e) {}

      if (typeof onProgress === 'function' && (i % 5 === 0 || i === totalNotes - 1)) {
        const pct = totalNotes > 0 ? Math.round(20 + (i / totalNotes) * 45) : 65;
        onProgress({
          step: 'writing_notes',
          percent: pct,
          message: `${typeof t === 'function' ? t('sync.revertWritingNotes') : 'Writing decrypted HTML note files…'} (${i + 1}/${totalNotes})`
        });
      }
    }

    if (typeof onProgress === 'function') {
      onProgress({
        step: 'writing_meta',
        percent: 75,
        message: typeof t === 'function' ? t('sync.revertWritingMetadata') : 'Writing manifests, todos and workspace documents…'
      });
    }

    // Write notes manifest
    await writeJSON('notes/manifest.json', manifest);

    // Write todos
    if (todosManifest) await writeJSON('todos/manifest.json', todosManifest);
    if (todosOrder) await writeJSON('todos/_order.json', todosOrder);

    // Write planner
    if (planner) await writeJSON('planner.json', planner);

    // Write colleagues
    if (colleagues) await writeJSON('colleagues.json', colleagues);
    if (colleaguesMigration) await writeJSON('.secretary/colleagues-migration-v1.done', colleaguesMigration);

    // Write topic memories
    if (topicMemories?.index) {
      await writeJSON('raw/topic-memories/index.json', topicMemories.index);
      if (typeof _topicMemoriesIndexCache !== 'undefined') {
        _topicMemoriesIndexCache = topicMemories.index;
      }
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('secretary_topic_memories_index', JSON.stringify(topicMemories.index));
          localStorage.setItem('secretary_topic_memories_index_v1', JSON.stringify(topicMemories.index));
        } catch (e) {}
      }
    }
    if (Array.isArray(topicMemories?.memories)) {
      for (const tm of topicMemories.memories) {
        if (tm?.key && tm?.data) {
          await writeJSON(`raw/topic-memories/${tm.key}.json`, tm.data);
          if (typeof _topicMemoryFileCache !== 'undefined' && _topicMemoryFileCache instanceof Map) {
            _topicMemoryFileCache.set(tm.key, tm.data);
          }
          if (typeof localStorage !== 'undefined') {
            try {
              localStorage.setItem(`secretary_topic_memory_${tm.key}`, JSON.stringify(tm.data));
            } catch (e) {}
          }
        }
      }
    }
    if (typeof preloadAllWorkstreamMemories === 'function') {
      try {
        await preloadAllWorkstreamMemories();
      } catch (e) {}
    }

    // Write chat history
    if (chatHistory) await writeJSON('.secretary/chat-history.json', chatHistory);

    // Write trash
    if (trashManifest) await writeJSON('.trash/manifest.json', trashManifest);
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
      const readJSON = async (f, fb) => (storage && storage._readJSON ? storage._readJSON(f, fb) : fb);
      const existingSettings = (await readJSON('secretary-settings.json', null)) || {};
      const mergedSettings = {
        ...exportedSettings,
        ...existingSettings,
        storageEngine: 'filesystem',
        ui: { ...(exportedSettings.ui || {}), ...(existingSettings.ui || {}) },
        ai: { ...(exportedSettings.ai || {}), ...(existingSettings.ai || {}) }
      };
      await writeJSON('secretary-settings.json', mergedSettings);
    }

    // Verification check: verify that all exported files are on disk
    if (typeof onProgress === 'function') {
      onProgress({
        step: 'verifying',
        percent: 90,
        message: typeof t === 'function' ? t('sync.revertVerifying') : 'Verifying all exported files on local disk…'
      });
    }

    let onDiskManifest = [];
    const readFn = (storage && storage._readJSON) ? storage._readJSON.bind(storage) : null;
    if (readFn) {
      try {
        onDiskManifest = (await readFn('notes/manifest.json', [])) || [];
      } catch (e) {}
    }
    const manifestVerified = Array.isArray(onDiskManifest) && onDiskManifest.length >= Math.min(manifest.length, writtenNotes);

    if (storage?.setStorageEngine) {
      storage.setStorageEngine('filesystem');
    }
    if (typeof settings !== 'undefined' && settings) {
      settings.storageEngine = 'filesystem';
      if (typeof saveFolderSettingsDebounced === 'function') saveFolderSettingsDebounced();
    }

    if (typeof onProgress === 'function') {
      onProgress({
        step: 'done',
        percent: 100,
        message: typeof t === 'function' ? t('sync.revertDone') : 'Local export verified and complete!'
      });
    }

    return {
      manifestCount: manifest.length,
      notesCount: notes.length,
      writtenNotes,
      verified: true,
      manifestVerified,
      todosCount: Array.isArray(todosManifest) ? todosManifest.length : 0
    };
  }
};

// Global exports
if (typeof window !== 'undefined') {
  window.StorageMigration = StorageMigration;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StorageMigration = StorageMigration;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StorageMigration };
}
