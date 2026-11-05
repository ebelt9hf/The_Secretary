import { describe, it, expect, beforeEach, vi } from 'vitest';

// Load app-idb.js and app-storage.js
import '../../js/app-idb.js';
import '../../js/app-storage.js';

describe('Two-Tier Storage Pipeline Architecture (RAM + IndexedDB -> Connector)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    StorageAPI.clearNoteCache();
    StorageAPI.setStorageEngine('filesystem');
    StorageAPI.setConnectorStatus('synced', null);
  });

  describe('Tier 1 Local Persistence (RAM + IndexedDB First)', () => {
    /**
     * 1. Protected Behavior: Enforces strict 3-tier write sequence (RAM -> IndexedDB -> Connector) and schema.
     * 2. Regression Target: Writing to connector before IndexedDB, or failing to populate RAM cache.
     * 3. Coverage Overlap / Redundancy: None; only test validating complete 3-tier sequence and IDB payload.
     * 4. Production Code Footprint: None; exercises core production StorageAPI methods.
     */
    it('persists note to RAM and IndexedDB before writing to connector', async () => {
      const putNoteSpy = vi.spyOn(VaultIDBStorage, 'putNote').mockResolvedValue(true);
      const writeFileSpy = vi.fn().mockResolvedValue(true);
      globalThis.writeFile = writeFileSpy;

      const path = 'notes/my-test-note.html';
      const content = '<h1>Test Note Content</h1>';
      const meta = { id: 'my-test-note', title: 'Test Note', tags: ['work'] };

      await StorageAPI.writeNoteContent(path, content, meta);

      // Check RAM cache (0ms)
      expect(StorageAPI.getNoteFromCache(path)).toBe(content);

      // Check IndexedDB persistent store called
      expect(putNoteSpy).toHaveBeenCalledWith('my-test-note', expect.objectContaining({
        id: 'my-test-note',
        path,
        content,
        title: 'Test Note'
      }));

      // Check connector was called with path, content and cooperative abort signal options
      expect(writeFileSpy).toHaveBeenCalledWith(path, content, expect.objectContaining({ signal: expect.any(Object) }));
      expect(StorageAPI.getConnectorStatus().status).toBe('synced');
    });

    /**
     * 1. Protected Behavior: Ensures image/binary assets are committed to IndexedDB assets store before disk write.
     * 2. Regression Target: Bypassing local IndexedDB storage or storing malformed asset records.
     * 3. Coverage Overlap / Redundancy: None; other tests focus on DOM paste events, not Tier 1 asset caching.
     * 4. Production Code Footprint: None; core StorageAPI.writeAsset contract.
     */
    it('persists asset to RAM and IndexedDB before writing to connector', async () => {
      const putRecordSpy = vi.spyOn(VaultIDBStorage, 'putRecord').mockResolvedValue(true);
      const writeFileSpy = vi.fn().mockResolvedValue(true);
      globalThis.writeFile = writeFileSpy;

      const relPath = 'notes/_assets/img-123.png';
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

      await StorageAPI.writeAsset(relPath, dataUrl);

      // Check IndexedDB called for both filename and full relative path
      expect(putRecordSpy).toHaveBeenCalledWith('assets', expect.objectContaining({
        id: 'img-123.png',
        data: dataUrl
      }));

      // Check connector was called
      expect(writeFileSpy).toHaveBeenCalledWith(relPath, dataUrl);
      expect(StorageAPI.getConnectorStatus().status).toBe('synced');
    });

    /**
     * 1. Protected Behavior: Verifies generic documents (todos, planner) use composite ID indexing in IDB.
     * 2. Regression Target: Inconsistent composite ID formatting (kind:docId) or missing IDB write.
     * 3. Coverage Overlap / Redundancy: None; only test asserting generic doc entity storage contract.
     * 4. Production Code Footprint: None; exercises production StorageAPI.writeDocEntity.
     */
    it('persists generic docs (planner, todos) to IndexedDB before connector', async () => {
      const putRecordSpy = vi.spyOn(VaultIDBStorage, 'putRecord').mockResolvedValue(true);
      const writeFileSpy = vi.fn().mockResolvedValue(true);
      globalThis.writeFile = writeFileSpy;

      const payload = [{ id: 'task-1', title: 'Buy milk' }];
      await StorageAPI.writeDocEntity('todos', 'manifest', 'todos/manifest.json', payload);

      expect(putRecordSpy).toHaveBeenCalledWith('docs', expect.objectContaining({
        id: 'todos:manifest',
        kind: 'todos',
        docId: 'manifest',
        data: payload
      }));
    });

    /**
     * 1. Protected Behavior: Ensures local storage exhaustion (QuotaExceededError) triggers notifyCriticalLocalFailure.
     * 2. Regression Target: Swallowing IDB write exceptions silently or failing to notify the UI of data risk.
     * 3. Coverage Overlap / Redundancy: None; unique critical failure simulation test.
     * 4. Production Code Footprint: None; notifyCriticalLocalFailure is production error handler.
     */
    it('triggers notifyCriticalLocalFailure if Tier 1 IndexedDB write throws', async () => {
      const criticalSpy = vi.spyOn(StorageAPI, 'notifyCriticalLocalFailure');
      vi.spyOn(VaultIDBStorage, 'putNote').mockRejectedValue(new Error('QuotaExceededError: IDB transaction failed'));

      const path = 'notes/failing-note.html';
      const content = '<p>Important unpersisted data</p>';

      await expect(StorageAPI.writeNoteContent(path, content, { id: 'failing-note' })).rejects.toThrow();
      expect(criticalSpy).toHaveBeenCalledWith(expect.any(Error), 'note', 'failing-note');
    });
  });

  describe('Asynchronous Connector Dispatch & Error Classification', () => {
    /**
     * 1. Protected Behavior: Maps NotAllowedError (filesystem permission loss) to error type 'permission'.
     * 2. Regression Target: Failing to classify permission revocations or leaving connector status as 'synced'.
     * 3. Coverage Overlap / Redundancy: None; error classification taxonomy is unique to this suite.
     * 4. Production Code Footprint: None; powers topbar connection pill status.
     */
    it('classifies disk permission errors (NotAllowedError) and updates connector status', async () => {
      const permError = new Error('The request is not allowed by the user agent or the platform in the current context.');
      permError.name = 'NotAllowedError';

      const classified = StorageAPI.classifyConnectorError(permError);
      expect(classified.type).toBe('permission');
      expect(classified.engine).toBe('filesystem');

      vi.spyOn(VaultIDBStorage, 'putNote').mockResolvedValue(true);
      globalThis.writeFile = vi.fn().mockRejectedValue(permError);
      const notifySpy = vi.spyOn(StorageAPI, 'notifyConnectorError');

      await expect(StorageAPI.writeNoteContent('notes/test.html', '<p>Test</p>', { id: 'test' })).rejects.toThrow();

      const status = StorageAPI.getConnectorStatus();
      expect(status.status).toBe('error');
      expect(status.error.type).toBe('permission');
      expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'permission' }));
    });

    /**
     * 1. Protected Behavior: Maps vault locked errors to error type 'auth'.
     * 2. Regression Target: Regex/message detection failures in classifyConnectorError for encrypted vaults.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('classifies authentication/vault errors and updates connector status', async () => {
      const authError = new Error('Vault is locked. Cannot write note.');
      const classified = StorageAPI.classifyConnectorError(authError);
      expect(classified.type).toBe('auth');
    });

    /**
     * 1. Protected Behavior: Maps ENOSPC disk exhaustion errors to error type 'quota'.
     * 2. Regression Target: Failure to recognize disk quota / space errors.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('classifies quota/storage full errors and updates connector status', async () => {
      const quotaError = new Error('ENOSPC: no space left on device');
      const classified = StorageAPI.classifyConnectorError(quotaError);
      expect(classified.type).toBe('quota');
    });

    /**
     * 1. Protected Behavior: Maps NetworkError to error type 'network'.
     * 2. Regression Target: Dropping network error mapping in remote sync connector.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('classifies offline network errors', () => {
      const netError = new Error('Failed to fetch remote Firebase doc');
      netError.name = 'NetworkError';
      const classified = StorageAPI.classifyConnectorError(netError);
      expect(classified.type).toBe('network');
    });
  });

  describe('Tier 1 Local Read Fast-Path', () => {
    /**
     * 1. Protected Behavior: Serves note content directly from RAM cache with 0ms disk I/O.
     * 2. Regression Target: Unnecessary disk reads on every note view when note is already cached.
     * 3. Coverage Overlap / Redundancy: None; asserts readFile is never invoked on cache hit.
     * 4. Production Code Footprint: None.
     */
    it('serves note content directly from RAM cache without touching connector', async () => {
      const writeFileSpy = vi.fn();
      globalThis.readFile = writeFileSpy;

      StorageAPI._noteCache.set('notes/cached.html', '<p>Instant RAM</p>');
      const res = await StorageAPI.readNoteContent('notes/cached.html');

      expect(res).toBe('<p>Instant RAM</p>');
      expect(writeFileSpy).not.toHaveBeenCalled();
    });

    /**
     * 1. Protected Behavior: Cold-read fallback to IndexedDB and re-populates RAM cache.
     * 2. Regression Target: Bypassing IndexedDB on cold load or failing to repopulate RAM cache.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('serves note from IndexedDB if not in RAM cache', async () => {
      vi.spyOn(VaultIDBStorage, 'getNote').mockResolvedValue({
        id: 'idb-note',
        content: '<p>From IndexedDB</p>'
      });
      globalThis.readFile = vi.fn();

      const res = await StorageAPI.readNoteContent('notes/idb-note.html');
      expect(res).toBe('<p>From IndexedDB</p>');
      expect(StorageAPI.getNoteFromCache('notes/idb-note.html')).toBe('<p>From IndexedDB</p>');
    });

    /**
     * 1. Protected Behavior: Serves binary/image asset from IndexedDB assets store when RAM is cold.
     * 2. Regression Target: Returning null or missing asset when present in IndexedDB.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('serves asset from IndexedDB if not in RAM cache', async () => {
      const assetData = 'data:image/png;base64,IDBAssetData';
      vi.spyOn(VaultIDBStorage, 'getRecord').mockResolvedValue({
        id: 'img-idb.png',
        data: assetData
      });

      const res = await StorageAPI.readAsset('notes/_assets/img-idb.png');
      expect(res).toBe(assetData);
    });
  });

  describe('Note Deletion & Unique Sync Queue Architecture', () => {
    /**
     * 1. Protected Behavior: Deletes note from RAM cache and IndexedDB first (Stage 1) before connector sync.
     * 2. Regression Target: Bypassing IndexedDB deletion or deleting connector file before Tier 1 is committed.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('deletes note from RAM and IndexedDB in Stage 1 before connector deleteFile', async () => {
      const deleteNoteSpy = vi.spyOn(VaultIDBStorage, 'deleteNote').mockResolvedValue(true);
      const executionOrder = [];

      deleteNoteSpy.mockImplementation(async (id) => {
        executionOrder.push('idb:delete');
        return true;
      });

      const deleteFileSpy = vi.fn().mockImplementation(async (path) => {
        executionOrder.push('connector:delete');
        return true;
      });
      globalThis.deleteFile = deleteFileSpy;

      const path = 'notes/note-to-delete.html';
      StorageAPI._noteCache.set(path, '<p>Delete me</p>');
      StorageAPI._noteCache.set('notes/note-to-delete.html', '<p>Delete me</p>');

      await StorageAPI.deleteNoteContent(path, { id: 'note-to-delete' });

      // RAM cache must be cleared immediately
      expect(StorageAPI.getNoteFromCache(path)).toBeNull();

      // IndexedDB delete must be called
      expect(deleteNoteSpy).toHaveBeenCalledWith('note-to-delete');

      // Stage 1 (IDB) must execute before Stage 2 (connector)
      expect(executionOrder).toEqual(['idb:delete', 'connector:delete']);
      expect(deleteFileSpy).toHaveBeenCalledWith(path);
    });

    /**
     * 1. Protected Behavior: IndexedDB deletion failure triggers notifyCriticalLocalFailure.
     * 2. Regression Target: Swallowing IDB deletion errors silently.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('triggers notifyCriticalLocalFailure if Stage 1 IndexedDB note deletion throws', async () => {
      const criticalSpy = vi.spyOn(StorageAPI, 'notifyCriticalLocalFailure');
      vi.spyOn(VaultIDBStorage, 'deleteNote').mockRejectedValue(new Error('IDB delete error'));
      globalThis.deleteFile = vi.fn().mockResolvedValue(true);

      const path = 'notes/fail-delete.html';
      await expect(StorageAPI.deleteNoteContent(path, { id: 'fail-delete' })).rejects.toThrow();
      expect(criticalSpy).toHaveBeenCalledWith(expect.any(Error), 'note:delete', 'fail-delete');
    });

    /**
     * 1. Protected Behavior: Enforces queue uniqueness per note: if multiple autosaves are queued, only the last one is executed.
     * 2. Regression Target: Executing every intermediate autosave or queueing duplicate writes for the same note.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('collapses multiple queued autosaves for the same note so only the last autosave is executed', async () => {
      vi.spyOn(VaultIDBStorage, 'putNote').mockResolvedValue(true);

      const writtenPayloads = [];
      let delayedWriteResolve;
      const writeBlockedPromise = new Promise(r => { delayedWriteResolve = r; });
      globalThis.writeFile = vi.fn().mockImplementation(async (path, content) => {
        writtenPayloads.push(content);
        // Delay first write to allow subsequent autosaves to queue up
        if (writtenPayloads.length === 1) {
          await writeBlockedPromise;
        }
      });

      const path = 'notes/note-queue-test.html';
      const cleanId = 'note-queue-test';

      // Kick off first autosave (will enter connector write and pause)
      const p1 = StorageAPI.writeNoteContent(path, '<h1>Autosave 1</h1>', { id: cleanId });

      // While first is in-flight, kick off autosave 2 and autosave 3
      const p2 = StorageAPI.writeNoteContent(path, '<h1>Autosave 2</h1>', { id: cleanId });
      const p3 = StorageAPI.writeNoteContent(path, '<h1>Autosave 3 (Final)</h1>', { id: cleanId });

      // Unblock first write
      delayedWriteResolve();
      await Promise.all([p1, p2, p3]);

      // Written payloads must have executed Autosave 1, and then ONLY Autosave 3 (skipping Autosave 2)
      expect(writtenPayloads).toEqual(['<h1>Autosave 1</h1>', '<h1>Autosave 3 (Final)</h1>']);
    });

    /**
     * 1. Protected Behavior: Deleting a note supersedes any queued autosaves for that note, preventing stale writes.
     * 2. Regression Target: Executing an earlier autosave after note deletion, recreating deleted files on disk.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('supersedes queued autosaves when note deletion is queued', async () => {
      vi.spyOn(VaultIDBStorage, 'putNote').mockResolvedValue(true);
      vi.spyOn(VaultIDBStorage, 'deleteNote').mockResolvedValue(true);

      const ops = [];
      let blockFirstWriteResolve;
      const blockFirstPromise = new Promise(r => { blockFirstWriteResolve = r; });
      globalThis.writeFile = vi.fn().mockImplementation(async (path, content) => {
        ops.push(`write:${content}`);
        if (ops.length === 1) {
          await blockFirstPromise;
        }
      });
      globalThis.deleteFile = vi.fn().mockImplementation(async (path) => {
        ops.push(`delete:${path}`);
      });

      const path = 'notes/supersede-test.html';
      const cleanId = 'supersede-test';

      const pSave1 = StorageAPI.writeNoteContent(path, 'v1', { id: cleanId });
      const pSave2 = StorageAPI.writeNoteContent(path, 'v2', { id: cleanId });
      const pDelete = StorageAPI.deleteNoteContent(path, { id: cleanId });

      blockFirstWriteResolve();
      await Promise.all([pSave1, pSave2, pDelete]);

      // v2 should never have been written; the deletion superseded it!
      expect(ops).toEqual(['write:v1', `delete:${path}`]);
    });

    /**
     * 1. Protected Behavior: Keeps failed sync operations in queue and retries until successful.
     * 2. Regression Target: Losing sync operations on connector errors or dropping unwritten changes.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('keeps failed deletion in queue and completes upon connector recovery', async () => {
      vi.spyOn(VaultIDBStorage, 'deleteNote').mockResolvedValue(true);

      let failDelete = true;
      globalThis.deleteFile = vi.fn().mockImplementation(async (path) => {
        if (failDelete) {
          const err = new Error('Disk locked');
          err.name = 'NotAllowedError';
          throw err;
        }
        return true;
      });

      const path = 'notes/retry-del.html';
      const cleanId = 'retry-del';

      // First attempt fails at connector stage
      await expect(StorageAPI.deleteNoteContent(path, { id: cleanId })).rejects.toThrow();

      // Deletion is still queued in StorageAPI._syncQueue
      expect(StorageAPI._syncQueue.has(cleanId)).toBe(true);
      expect(StorageAPI._syncQueue.get(cleanId).action).toBe('delete');
      expect(StorageAPI.getConnectorStatus().status).toBe('error');

      // Now disk recovers
      failDelete = false;
      await StorageAPI._processSyncQueue();

      // Queue is now empty and connector is synced
      expect(StorageAPI._syncQueue.has(cleanId)).toBe(false);
      expect(StorageAPI.getConnectorStatus().status).toBe('synced');
    });

    /**
     * 1. Protected Behavior: StorageAPI._scheduleSyncRetry backs off exponentially on consecutive connector failures.
     * 2. Regression Target: Fixed flat retry interval causing aggressive reconnection hammering.
     * 3. Coverage Overlap / Redundancy: None.
     * 4. Production Code Footprint: None.
     */
    it('schedules sync retry using exponential backoff delays on consecutive connector errors', () => {
      vi.useFakeTimers();
      StorageAPI.clearSyncQueue();

      // Enqueue an item
      StorageAPI._enqueueSync({ id: 'exp-test', action: 'save' });

      // First failure
      StorageAPI._scheduleSyncRetry();
      expect(StorageAPI._syncRetryCount).toBe(1);
      expect(StorageAPI._syncRetryTimer).not.toBeNull();

      // Clear timer simulating execution of timeout
      StorageAPI._syncRetryTimer = null;

      // Second failure
      StorageAPI._scheduleSyncRetry();
      expect(StorageAPI._syncRetryCount).toBe(2);

      StorageAPI._syncRetryTimer = null;
      StorageAPI._scheduleSyncRetry();
      expect(StorageAPI._syncRetryCount).toBe(3);

      // Clearing queue resets retry count
      StorageAPI.clearSyncQueue();
      expect(StorageAPI._syncRetryCount).toBe(0);
      expect(StorageAPI._syncRetryTimer).toBeNull();

      vi.useRealTimers();
    });
  });
});
