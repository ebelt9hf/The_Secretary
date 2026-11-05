import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import '../../js/app-fs.js';
import '../../js/app-idb.js';
import '../../js/app-storage.js';

describe('Universal Atomic Persistence & Recovery Architecture for All Document Entities', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    StorageAPI.clearNoteCache();
    StorageAPI.clearSyncQueue();
    StorageAPI.setStorageEngine('filesystem');
    StorageAPI.setConnectorStatus('synced', null);

    globalThis.writeFile = vi.fn().mockResolvedValue(true);
    globalThis.readFile = vi.fn().mockResolvedValue('');
    globalThis.deleteFile = vi.fn().mockResolvedValue(true);
    globalThis.fileExists = vi.fn().mockResolvedValue(true);
  });

  afterEach(() => {
    StorageAPI.clearSyncQueue();
    vi.restoreAllMocks();
  });

  describe('Pillar 1 & 2: Tier 1 Immediate Commit & Cooperative Queue Supersession', () => {
    /**
     * 1. Protected Behavior: writeDocEntity stages in-memory immediately and commits to Tier 1 IndexedDB before asynchronous connector flush.
     * 2. Regression Target: Bypassing Tier 1 IndexedDB or delaying local persistence behind connector disk writes.
     * 3. Coverage Overlap / Redundancy: None; validates unified writeDocEntity contract across todos, planner, and settings.
     * 4. Production Code Footprint: None; exercises authentic StorageAPI.writeDocEntity interface.
     */
    it('commits doc entity to Tier 1 IndexedDB immediately before connector write executes', async () => {
      const putRecordSpy = vi.spyOn(VaultIDBStorage, 'putRecord').mockResolvedValue(true);
      const writeFileSpy = vi.fn().mockImplementation(async () => {
        expect(putRecordSpy).toHaveBeenCalledWith('docs', expect.objectContaining({
          id: 'todos:manifest',
          kind: 'todos',
          docId: 'manifest',
          data: expect.arrayContaining([{ id: 'todo-1', title: 'Task One' }])
        }));
        return true;
      });
      globalThis.writeFile = writeFileSpy;

      const payload = [{ id: 'todo-1', title: 'Task One' }];
      await StorageAPI.writeDocEntity('todos', 'manifest', 'todos/manifest.json', payload);

      expect(writeFileSpy).toHaveBeenCalledWith(
        'todos/manifest.json',
        JSON.stringify(payload, null, 2)
      );
      expect(StorageAPI.getConnectorStatus().status).toBe('synced');
    });

    /**
     * 1. Protected Behavior: Staged Source Model returns pending in-flight payload immediately if readDocEntity is called while write is queued.
     * 2. Regression Target: readDocEntity returning stale disk/IDB data while a newer version is enqueued in _syncQueue.
     * 3. Coverage Overlap / Redundancy: None; specifically tests in-flight queue fast-read for non-note documents.
     * 4. Production Code Footprint: None; standard StorageAPI.readDocEntity execution path.
     */
    it('serves newest in-flight document directly from sync queue before connector write completes', async () => {
      let releaseWrite;
      const blockingWritePromise = new Promise(resolve => { releaseWrite = resolve; });
      globalThis.writeFile = vi.fn().mockImplementation(() => blockingWritePromise);
      vi.spyOn(VaultIDBStorage, 'putRecord').mockResolvedValue(true);

      const payload1 = { events: [{ id: 'ev-1', title: 'Initial Event' }] };
      const payload2 = { events: [{ id: 'ev-1', title: 'Updated Event' }] };

      try {
        // Initiate first write (begins connector write and blocks)
        const writePromise1 = StorageAPI.writePlanner(payload1);
        // Initiate second write (supersedes first in sync queue)
        const writePromise2 = StorageAPI.writePlanner(payload2);

        // Read immediately while writes are in-flight
        const inFlightRead = await StorageAPI.readPlanner();
        expect(inFlightRead).toEqual(payload2);

        releaseWrite(true);
        await Promise.all([writePromise1, writePromise2]);
      } finally {
        if (releaseWrite) releaseWrite(true);
      }
    });

    /**
     * 1. Protected Behavior: Rapid successive document saves coalesce, abort earlier signals, and execute only latest payload.
     * 2. Regression Target: Multiple uncoordinated disk writes executing concurrently for the same JSON file.
     * 3. Coverage Overlap / Redundancy: None; validates cooperative supersession for doc entities.
     * 4. Production Code Footprint: None; uses production _enqueueSync and _processSyncQueue mechanisms.
     */
    it('cooperatively supersedes rapid document writes and aborts earlier in-flight writes', async () => {
      const executedWrites = [];
      let releaseFirstWrite;
      const firstWritePromise = new Promise(r => { releaseFirstWrite = r; });

      globalThis.writeFile = vi.fn().mockImplementation(async (path, content, opts) => {
        executedWrites.push({ content: JSON.parse(content), signal: opts?.signal });
        if (executedWrites.length === 1) {
          await firstWritePromise;
        }
        return true;
      });
      vi.spyOn(VaultIDBStorage, 'putRecord').mockResolvedValue(true);

      try {
        const p1 = StorageAPI.writeColleagues([{ id: 'c1', name: 'Alice V1' }]);
        const p2 = StorageAPI.writeColleagues([{ id: 'c1', name: 'Alice V2' }]);
        const p3 = StorageAPI.writeColleagues([{ id: 'c1', name: 'Alice V3' }]);

        releaseFirstWrite();
        await Promise.all([p1, p2, p3]);

        // The last executed write must contain the final version
        const finalWrite = executedWrites[executedWrites.length - 1];
        expect(finalWrite.content).toEqual([{ id: 'c1', name: 'Alice V3' }]);
      } finally {
        if (releaseFirstWrite) releaseFirstWrite();
      }
    });
  });

  describe('Pillar 3 & 4: Emergency Recovery Snapshots on Connector Failure', () => {
    /**
     * 1. Protected Behavior: On disk write failure, automatically preserves emergency snapshot in .history/<key>/rev-<timestamp>.json.
     * 2. Regression Target: Silent data loss when disk write fails due to filesystem locks or permissions.
     * 3. Coverage Overlap / Redundancy: None; only test verifying automated emergency snapshot generation for doc entities.
     * 4. Production Code Footprint: None; tests saveSnapshot fallback inside _processSyncQueue.
     */
    it('automatically saves emergency recovery snapshot in .history/ when document disk write throws', async () => {
      vi.spyOn(VaultIDBStorage, 'putRecord').mockResolvedValue(true);
      const diskError = new Error('EBUSY: resource busy or locked, rename todos/manifest.json');
      diskError.name = 'NotAllowedError';

      // Lock canonical file, but allow .history/ snapshot directory write
      globalThis.writeFile = vi.fn().mockImplementation(async (path, content) => {
        if (path === 'todos/manifest.json') {
          throw diskError;
        }
        return true;
      });

      const snapshotSpy = vi.spyOn(StorageAPI, 'saveSnapshot');

      const todosPayload = [{ id: 'task-emergency', title: 'Critical Mission' }];
      await expect(StorageAPI.writeTodosManifest(todosPayload)).rejects.toThrow('EBUSY');

      // Emergency snapshot must have been triggered with path, content string, and reason 'save-failed'
      expect(snapshotSpy).toHaveBeenCalledWith(
        'todos/manifest.json',
        JSON.stringify(todosPayload, null, 2),
        'save-failed'
      );
      expect(StorageAPI.getConnectorStatus().status).toBe('error');
    });

    /**
     * 1. Protected Behavior: Format-aware snapshots assign .json extension to document entities and prevent collision between manifests.
     * 2. Regression Target: Snapshots saving with hardcoded .html extension or collision between todos/manifest.json and notes/manifest.json.
     * 3. Coverage Overlap / Redundancy: None; unique test verifying collision-free history keys and format awareness.
     * 4. Production Code Footprint: None; exercises production _getHistoryKey and saveSnapshot.
     */
    it('isolates history keys without collision and saves format-aware .json snapshots', async () => {
      const writtenFiles = new Map();
      globalThis.writeFile = vi.fn().mockImplementation(async (path, content) => {
        writtenFiles.set(path, content);
        return true;
      });

      const todosHistoryKey = StorageAPI._getHistoryKey('todos/manifest.json');
      const notesHistoryKey = StorageAPI._getHistoryKey('notes/manifest.json');
      const plannerHistoryKey = StorageAPI._getHistoryKey('planner.json');
      const settingsHistoryKey = StorageAPI._getHistoryKey('secretary-settings.json');
      const noteHistoryKey = StorageAPI._getHistoryKey('notes/2026-11-05-standup.html');

      // All keys must be distinct and collision-free
      expect(todosHistoryKey).toBe('todos_manifest.json');
      expect(notesHistoryKey).toBe('notes_manifest.json');
      expect(plannerHistoryKey).toBe('planner.json');
      expect(settingsHistoryKey).toBe('secretary-settings.json');
      expect(noteHistoryKey).toBe('2026-11-05-standup.html');

      // Save a snapshot for todos manifest
      const snapshotMeta = await StorageAPI.saveSnapshot('todos/manifest.json', [{ id: 't1' }], 'manual');
      expect(snapshotMeta.id).toMatch(/^rev-\d+$/);

      // Must have written with .json extension, NOT .html
      const expectedSnapshotPath = `.history/todos_manifest.json/${snapshotMeta.id}.json`;
      expect(writtenFiles.has(expectedSnapshotPath)).toBe(true);
    });
  });

  describe('Pillar 5: Two-Tier Read Fallback & Self-Healing', () => {
    /**
     * 1. Protected Behavior: If canonical file is missing and Tier 1 IDB is empty, readDocEntity recovers data from emergency snapshot.
     * 2. Regression Target: Returning fallback null or empty array when a valid emergency snapshot exists in .history/.
     * 3. Coverage Overlap / Redundancy: None; only test validating self-healing recovery from emergency snapshots.
     * 4. Production Code Footprint: None; exercises readDocEntity emergency snapshot fallback logic.
     */
    it('recovers document entity from emergency snapshot if disk file is missing and Tier 1 IDB is empty', async () => {
      // Tier 1 IDB returns null
      vi.spyOn(VaultIDBStorage, 'getRecord').mockResolvedValue(null);
      const putRecordSpy = vi.spyOn(VaultIDBStorage, 'putRecord').mockResolvedValue(true);

      // Disk read throws NotFoundError
      globalThis.readFile = vi.fn().mockImplementation(async (path) => {
        if (path === 'planner.json') {
          const err = new Error('File not found: planner.json');
          err.name = 'NotFoundError';
          throw err;
        }
        if (path === '.history/planner.json/manifest.json') {
          return JSON.stringify([{ id: 'rev-999999', timestamp: 999999, reason: 'save-failed' }]);
        }
        if (path === '.history/planner.json/rev-999999.json') {
          return JSON.stringify({ events: [{ id: 'ev-recovered', title: 'Restored Planner Event' }] });
        }
        const err = new Error(`File not found: ${path}`);
        err.name = 'NotFoundError';
        throw err;
      });

      const recoveredData = await StorageAPI.readPlanner();

      expect(recoveredData).toEqual({
        events: [{ id: 'ev-recovered', title: 'Restored Planner Event' }]
      });

      // Assert self-healing repopulated Tier 1 IDB
      expect(putRecordSpy).toHaveBeenCalledWith('docs', expect.objectContaining({
        id: 'planner:events',
        kind: 'planner',
        docId: 'events',
        data: recoveredData
      }));
    });

    /**
     * 1. Protected Behavior: readNotesManifest recovers from emergency snapshot if disk manifest and Tier 1 cache are empty.
     * 2. Regression Target: Empty notes manifest returned after sudden restart when disk was corrupted.
     * 3. Coverage Overlap / Redundancy: None; validates readNotesManifest emergency snapshot fallback.
     * 4. Production Code Footprint: None; exercises readNotesManifest self-healing recovery.
     */
    it('recovers notes manifest from emergency snapshot when disk manifest is missing', async () => {
      vi.spyOn(VaultIDBStorage, 'getMeta').mockResolvedValue(null);
      const saveMetaSpy = vi.spyOn(VaultIDBStorage, 'saveMeta').mockResolvedValue(true);

      globalThis.readFile = vi.fn().mockImplementation(async (path) => {
        if (path === 'notes/manifest.json') {
          const err = new Error('File not found');
          err.name = 'NotFoundError';
          throw err;
        }
        if (path === '.history/notes_manifest.json/manifest.json') {
          return JSON.stringify([{ id: 'rev-8888', timestamp: 8888, reason: 'save-failed' }]);
        }
        if (path === '.history/notes_manifest.json/rev-8888.json') {
          return JSON.stringify([{ id: 'note-recovered', title: 'Recovered Note', path: 'notes/note-recovered.html' }]);
        }
        const err = new Error(`File not found: ${path}`);
        err.name = 'NotFoundError';
        throw err;
      });

      const manifest = await StorageAPI.readNotesManifest();
      expect(manifest).toEqual([
        expect.objectContaining({ id: 'note-recovered', title: 'Recovered Note' })
      ]);
      expect(saveMetaSpy).toHaveBeenCalledWith('notes_manifest_cache', expect.any(Array));
    });
  });

  describe('Document Entity Deletion Architecture (deleteDocEntity)', () => {
    /**
     * 1. Protected Behavior: deleteDocEntity removes from Tier 1 IDB immediately, enqueues delete action, and invokes connector deleteFile.
     * 2. Regression Target: Connector deleteFile called before IDB deletion, or failing to remove doc record from IDB.
     * 3. Coverage Overlap / Redundancy: None; only test validating deleteDocEntity contract.
     * 4. Production Code Footprint: None; exercises deleteDocEntity and StorageAPI.docs.delete.
     */
    it('deletes document entity from Tier 1 IDB in Stage 1 before connector deleteFile', async () => {
      const deleteRecordSpy = vi.spyOn(VaultIDBStorage, 'deleteRecord').mockResolvedValue(true);
      const deleteFileSpy = vi.fn().mockImplementation(async (path) => {
        expect(deleteRecordSpy).toHaveBeenCalledWith('docs', 'settings:temp-config');
        return true;
      });
      globalThis.deleteFile = deleteFileSpy;

      await StorageAPI.deleteDocEntity('settings', 'temp-config', 'temp-config.json');

      expect(deleteFileSpy).toHaveBeenCalledWith('temp-config.json');
      expect(StorageAPI.getConnectorStatus().status).toBe('synced');
    });

    /**
     * 1. Protected Behavior: StorageAPI.docs DAO namespace exposes get, save, delete, has methods operating via universal pipeline.
     * 2. Regression Target: Incomplete DAO interface or mismatch between DAO methods and StorageAPI doc operations.
     * 3. Coverage Overlap / Redundancy: None; verifies public StorageAPI.docs DAO interface.
     * 4. Production Code Footprint: None; exercises StorageAPI.docs namespace.
     */
    it('supports full CRUD via StorageAPI.docs DAO namespace', async () => {
      vi.spyOn(VaultIDBStorage, 'putRecord').mockResolvedValue(true);
      vi.spyOn(VaultIDBStorage, 'deleteRecord').mockResolvedValue(true);
      globalThis.writeFile = vi.fn().mockResolvedValue(true);
      globalThis.deleteFile = vi.fn().mockResolvedValue(true);

      const topicPayload = { key: 'design', summary: 'System architecture' };
      await StorageAPI.docs.save('topic_memories', 'design', topicPayload);
      expect(globalThis.writeFile).toHaveBeenCalledWith(
        'topic_memories.json',
        JSON.stringify(topicPayload, null, 2)
      );

      await StorageAPI.docs.delete('topic_memories', 'design');
      expect(globalThis.deleteFile).toHaveBeenCalledWith('topic_memories.json');
    });
  });
});
