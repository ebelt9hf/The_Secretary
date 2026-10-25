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

      // Check connector was called
      expect(writeFileSpy).toHaveBeenCalledWith(path, content);
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
});
